/**
 * Model comparison harness: run several writers over one day's news with the real pipeline code
 * (feeds, filter, prompts, schemas, validation, providers, cost), in a throwaway data dir.
 * Nothing is published and the live database is never opened.
 *
 *   COMPARE_DATE=2026-11-09 \
 *   COMPARE_WRITERS=anthropic:claude-opus-5-5,openrouter:z-ai/glm-5.3 \
 *   COMPARE_CHECKER=anthropic:claude-opus-5-5 \
 *   COMPARE_OUT=compare.json \
 *   tsx scripts/compare-models.ts
 *
 * Needs EARLY_EDITION_KIDS_CONFIG plus the provider keys (LLM_API_KEY, OPENROUTER_API_KEY).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, settingsFromEnv, topicNames, type Config, type Settings } from "../src/config.js";
import { Database } from "../src/db.js";
import {
  extractArticle,
  fetchAll,
  filterCandidates,
  httpFetchFeed,
  httpFetchText,
  newReport,
  type Candidate,
  type FeedFetcher,
  type FilterReport,
  type PageFetcher,
} from "../src/feeds.js";
import {
  LLMError,
  LLMRefusal,
  clientFor,
  parseJsonObject,
  type CallUsage,
  type ChatMessage,
  type ChatOptions,
  type Clients,
  type Effort,
  type LLM,
} from "../src/llm.js";
import * as prompts from "../src/prompts.js";
import { buildContext, checkMessages, rewritePromptContext, selectStories, sourceTextFor } from "../src/pipeline.js";
import { catalog, namespaced, priceOf, splitModel } from "../src/providers.js";
import { CHECK_SCHEMA, rewriteSchema } from "../src/schemas.js";
import { generationNow, longDate } from "../src/timeutil.js";
import { callCost } from "../src/usage.js";
import { countWords, parseVerdict, storyWordCount, validateStory, type Story } from "../src/validate.js";
import { topicStats } from "../src/weights.js";

export const DEFAULT_WRITERS = [
  "anthropic:claude-opus-5-5",
  "anthropic:claude-sonnet-5-5",
  "openrouter:z-ai/glm-5.3",
  "openrouter:deepseek/deepseek-v4-pro-0813",
];
export const DEFAULT_CHECKER = "anthropic:claude-opus-5-5";
const WRITER_EFFORT: Effort = "medium";
const CHECKER_EFFORT: Effort = "high";
const CONCURRENCY = 3;
const EXCERPT_CHARS = 600;

export interface CompareOptions {
  settings: Settings;
  config: Config;
  date: string;
  writers: string[];
  checker: string;
  selector?: string;
  clients?: Clients;
  feedFetcher?: FeedFetcher;
  pageFetcher?: PageFetcher;
  /** The real time; the feed window is derived from COMPARE_DATE the way a generation would. */
  now?: Date;
  /** Stop starting new LLM calls once this much has been spent (USD). */
  budgetUsd?: number;
  /** Per-call timeout and retries, so one slow model can't stall the run. */
  callTimeoutMs?: number;
  /** Stop starting new calls after this long (ms), so the job always prints its results. */
  deadlineMs?: number;
  log?: (line: string) => void;
}

interface Meter {
  usage: CallUsage[];
}

/** Running total of spend across the whole comparison, for the budget stop. */
const spend = { usd: 0, config: null as Config | null };

/** Wrap an LLM so every response's usage is captured (on top of whatever the caller records). */
class Metered implements LLM {
  constructor(
    private inner: LLM,
    private sink: () => Meter,
  ) {}
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    return this.inner.chat(messages, {
      ...opts,
      onUsage: (u) => {
        this.sink().usage.push(u);
        if (spend.config) spend.usd += callCost(spend.config, u).cost;
        opts.onUsage?.(u);
      },
    });
  }
}

const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

function sumUsage(config: Config, usage: CallUsage[]) {
  return {
    input_tokens: usage.reduce((n, u) => n + u.input_tokens, 0),
    output_tokens: usage.reduce((n, u) => n + u.output_tokens, 0),
    cost_usd: round(usage.reduce((n, u) => n + callCost(config, u).cost, 0)),
    models_answered: [...new Set(usage.map((u) => u.model))],
    stop_reason: usage.at(-1)?.stop_reason ?? null,
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

const pickView = ([c, topic]: [Candidate, string]) => ({ candidate_id: c.id, title: c.title, source: c.sourceName, url: c.url, topic });

export async function runComparison(o: CompareOptions) {
  const log = o.log ?? ((line: string) => process.stderr.write(line + "\n"));
  const realNow = o.now ?? new Date();
  const writers = o.writers.map((w) => namespaced(w, o.settings));
  const checkerId = namespaced(o.checker, o.settings);
  const selectorId = namespaced(o.selector || writers[0], o.settings);
  const clients = o.clients ?? {};
  const config = o.config;
  const storyCount = config.storyCount;
  const allowed = topicNames(config);
  const todayLong = longDate(o.date);
  const budget = o.budgetUsd ?? Infinity;
  spend.usd = 0;
  spend.config = config;
  const started = Date.now();
  const deadline = o.deadlineMs ?? Infinity;
  const overBudget = () => spend.usd >= budget || Date.now() - started >= deadline;
  const stopReason = () => (spend.usd >= budget ? `budget of $${budget} reached` : "time limit reached");

  // A throwaway data dir: the live database is never opened.
  const dataDir = mkdtempSync(path.join(tmpdir(), "early-edition-kids-compare-"));
  const settings: Settings = { ...o.settings, dataDir, llmBaseUrl: o.settings.llmBaseUrl === "stub" ? "" : o.settings.llmBaseUrl };
  const db = new Database(path.join(dataDir, "compare.db"));
  db.init();
  try {
    const feedFetcher = o.feedFetcher ?? httpFetchFeed;
    const pageFetcher = o.pageFetcher ?? httpFetchText;
    const ctx = buildContext(settings, config, db, {
      feedFetcher,
      pageFetcher,
      anthropicClient: clients.anthropic,
      openrouterFetch: clients.openrouterFetch,
    });

    // ---- models ----
    const offered = new Map(catalog(settings, config, { anthropic: Boolean(clients.anthropic), openrouter: Boolean(clients.openrouterFetch) }).map((m) => [m.id, m]));
    const models = [...new Set([...writers, checkerId])].map((id) => {
      const m = offered.get(id);
      const price = m ?? priceOf(config, id) ?? { input_per_mtok: 0, output_per_mtok: 0 };
      return {
        id,
        name: m?.name ?? id,
        provider: splitModel(id, settings).provider,
        configured: Boolean(m),
        input_per_mtok: price.input_per_mtok,
        output_per_mtok: price.output_per_mtok,
      };
    });
    const tuning = { timeoutMs: o.callTimeoutMs, retries: 1 };
    const build = (id: string, effort: Effort): { llm: LLM | null; error: string | null } => {
      try {
        return { llm: clientFor(settings, id, effort, clients, o.callTimeoutMs ? tuning : {}), error: null };
      } catch (err) {
        return { llm: null, error: err instanceof Error ? err.message : String(err) };
      }
    };

    // ---- phase 1: candidates, exactly as a generation for the date would build them ----
    const windowEnd = generationNow(o.date, realNow);
    const feedLog: string[] = [];
    const items = await fetchAll(config.feeds, feedFetcher, feedLog);
    const feedCounts: Record<string, number> = {};
    for (const f of config.feeds) feedCounts[f.name] = items.filter((i) => i.feed.name === f.name).length;
    const report: FilterReport = newReport();
    const candidates = filterCandidates(items, { now: windowEnd, config, report });
    log(`[compare] candidates for ${o.date}: ${candidates.length} (${feedLog.join("; ")})`);
    const tstats = topicStats(config, {}, []);

    // ---- phase 2: every writer selects from the same candidates ----
    const selection: Record<string, any> = {};
    const queues: Record<string, Array<[Candidate, string]>> = {};
    const selecting = new Map<string, Promise<void>>();
    for (const id of writers) {
      selecting.set(id, (async () => {
        const { llm, error } = build(id, WRITER_EFFORT);
        const meter: Meter = { usage: [] };
        const detail: string[] = [];
        const t0 = Date.now();
        let queue: Array<[Candidate, string]> = [];
        let err = error;
        if (llm && candidates.length) {
          try {
            const writer = new Metered(llm, () => meter);
            queue = await selectStories({ ...ctx, writer, checker: writer, scope: { runId: null, jobId: null } }, candidates, tstats, allowed, todayLong, detail, storyCount);
            if (!queue.length) err = detail.filter((l) => l.startsWith("select")).join("; ") || "no usable picks";
          } catch (e) {
            err = e instanceof Error ? e.message : String(e);
          }
        } else if (!candidates.length) {
          err = "no candidates";
        }
        queues[id] = queue;
        const seconds = round((Date.now() - t0) / 1000, 1);
        const u = sumUsage(config, meter.usage);
        selection[id] = {
          picks: queue.slice(0, storyCount).map(pickView),
          reserves: queue.slice(storyCount).map(pickView),
          ...u,
          seconds,
          error: err,
        };
        log(`[compare] select ${id}: ${err ? `error: ${err}` : `${queue.length} chosen`} ${seconds}s in=${u.input_tokens} out=${u.output_tokens} $${u.cost_usd}`);
      })());
    }
    // Writing starts once the selector has chosen; the other selections finish alongside.
    await (selecting.get(selectorId) ?? Promise.resolve());
    if (!queues[selectorId]?.length) await Promise.all(selecting.values());

    // ---- phase 3: every writer rewrites the selector's picks; one attempt each; the common checker ----
    const selectorUsed = queues[selectorId]?.length ? selectorId : (writers.find((w) => queues[w]?.length) ?? null);
    const shared = selectorUsed ? queues[selectorUsed].slice(0, storyCount) : [];
    const checker = build(checkerId, CHECKER_EFFORT);

    const stories = await Promise.all(
      shared.map(async ([cand, topic]) => {
        let article = "";
        let extractError: string | null = null;
        try {
          article = await extractArticle(cand, pageFetcher, config.sourceCharLimit);
        } catch (e) {
          extractError = e instanceof Error ? e.message : String(e);
        }
        return {
          candidate_id: cand.id,
          source_title: cand.title,
          source_url: cand.url,
          source_name: cand.sourceName,
          topic,
          source_words: countWords(article),
          excerpt: article.slice(0, EXCERPT_CHARS),
          extract_error: extractError,
          results: {} as Record<string, any>,
          _cand: cand,
          _article: article,
        };
      }),
    );

    const writerClients = Object.fromEntries(writers.map((id) => [id, build(id, WRITER_EFFORT)]));
    const tasks = stories.flatMap((s) => writers.map((id) => ({ s, id })));
    await pool(tasks, CONCURRENCY, async ({ s, id }) => {
      const cand: Candidate = s._cand;
      const article: string = s._article;
      const result: Record<string, any> = {
        story: null,
        word_count: null,
        validation: null,
        checker: null,
        refused: false,
        refusal_category: null,
        error: null,
      };
      s.results[id] = result;
      if (s.extract_error) {
        result.error = `source could not be read: ${s.extract_error}`;
        return;
      }
      const { llm, error } = writerClients[id];
      if (!llm) {
        result.error = error;
        return;
      }
      if (overBudget()) {
        result.error = `skipped: ${stopReason()}`;
        log(`[compare] rewrite ${id} [${cand.id}]: skipped, ${stopReason()} ($${round(spend.usd, 4)})`);
        return;
      }
      const sourceText = sourceTextFor(cand, article);
      const writeMeter: Meter = { usage: [] };
      const t0 = Date.now();
      let data: Record<string, any> | null = null;
      try {
        const msgs = prompts.messages("rewrite", { ...rewritePromptContext(config, cand, s.topic, allowed, todayLong, article), problems: [] });
        const reply = await new Metered(llm, () => writeMeter).chat(msgs, {
          task: "rewrite",
          context: { candidate: cand, topic: s.topic, sourceText, allowedTopics: allowed, storyWords: config.storyWords },
          schema: rewriteSchema(allowed),
        });
        data = parseJsonObject(reply);
      } catch (e) {
        if (e instanceof LLMRefusal) {
          result.refused = true;
          result.refusal_category = e.category;
        }
        result.error = e instanceof Error ? e.message : String(e);
      }
      result.seconds = round((Date.now() - t0) / 1000, 1);
      Object.assign(result, { writer_usage: sumUsage(config, writeMeter.usage) });

      let story: Story | null = null;
      if (data) {
        const v = validateStory(data, { sourceText, sourceUrl: cand.url, allowedTopics: allowed, blocklist: config.blocklist, words: config.storyWords });
        story = v.story;
        result.validation = { ok: v.ok, reasons: v.errors };
        if (story) {
          result.story = {
            title: story.title,
            teaser: story.teaser,
            topic: story.topic,
            body: story.body,
            word_to_know: story.word_to_know,
            think_about_it: story.think_about_it,
          };
          result.word_count = storyWordCount(story);
        }
      }
      log(
        `[compare] rewrite ${id} [${cand.id}]: ${result.error ? `error: ${result.error}` : `${result.word_count} words, valid=${result.validation?.ok}`} ${result.seconds}s $${result.writer_usage.cost_usd}`,
      );

      if (story && checker.llm && overBudget()) {
        result.checker = { safe: false, supported: false, reasons: [], error: `skipped: ${stopReason()}` };
      } else if (story && checker.llm) {
        const checkMeter: Meter = { usage: [] };
        const c0 = Date.now();
        try {
          const reply = await new Metered(checker.llm, () => checkMeter).chat(checkMessages(config, cand, article, story), {
            task: "check",
            context: { story, sourceText, candidate: cand },
            schema: CHECK_SCHEMA,
          });
          result.checker = { ...parseVerdict(parseJsonObject(reply)), error: null };
        } catch (e) {
          result.checker = {
            safe: false,
            supported: false,
            reasons: [],
            error: e instanceof Error ? e.message : String(e),
            refused: e instanceof LLMRefusal,
          };
        }
        result.checker.seconds = round((Date.now() - c0) / 1000, 1);
        result.checker.usage = sumUsage(config, checkMeter.usage);
        log(
          `[compare] check ${checkerId} on ${id} [${cand.id}]: safe=${result.checker.safe} supported=${result.checker.supported} ${result.checker.seconds}s $${result.checker.usage.cost_usd}`,
        );
      } else if (story && !checker.llm) {
        result.checker = { safe: false, supported: false, reasons: [], error: checker.error };
      }
    });

    await Promise.all(selecting.values());

    // ---- totals ----
    const totals: Record<string, any> = {};
    for (const id of writers) {
      const rs = stories.map((s) => s.results[id]).filter(Boolean);
      const written = rs.filter((r) => r.story);
      const words = written.map((r) => r.word_count as number);
      const seconds = rs.map((r) => r.seconds).filter((x): x is number => typeof x === "number");
      const selectCost = selection[id]?.cost_usd ?? 0;
      totals[id] = {
        stories_written: written.length,
        passed_validation: rs.filter((r) => r.validation?.ok).length,
        passed_checker: rs.filter((r) => r.checker?.safe && r.checker?.supported && !r.checker?.error).length,
        sent_back: rs.filter((r) => r.checker && !r.checker.error && !(r.checker.safe && r.checker.supported)).length,
        refused: rs.filter((r) => r.refused).length,
        errors: rs.filter((r) => r.error && !r.refused).length,
        avg_words: words.length ? round(words.reduce((a, b) => a + b, 0) / words.length, 1) : null,
        writer_cost_usd: round(selectCost + rs.reduce((n, r) => n + (r.writer_usage?.cost_usd ?? 0), 0)),
        checker_cost_usd: round(rs.reduce((n, r) => n + (r.checker?.usage?.cost_usd ?? 0), 0)),
        avg_seconds_per_story: seconds.length ? round(seconds.reduce((a, b) => a + b, 0) / seconds.length, 1) : null,
      };
    }

    return {
      meta: {
        date: o.date,
        generated_at: new Date().toISOString(),
        window_end: windowEnd.toISOString(),
        candidates: candidates.length,
        feed_counts: feedCounts,
        feed_log: feedLog,
        filter: report,
        story_count: storyCount,
        selector: selectorId,
        selector_used: selectorUsed,
        checker: checkerId,
        writer_effort: WRITER_EFFORT,
        checker_effort: CHECKER_EFFORT,
        checker_error: checker.error,
        budget_usd: Number.isFinite(budget) ? budget : null,
        spent_usd: round(spend.usd),
        note: "Candidates are built from the feeds as fetched now; feeds only carry recent items, so an older date can have few.",
      },
      models,
      selection,
      stories: stories.map(({ _cand, _article, ...rest }) => rest),
      totals,
    };
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const env = process.env;
  const settings = settingsFromEnv();
  const config = loadConfig(settings.configPath);
  const list = (v: string | undefined, fallback: string[]) =>
    v ? v.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
  const result = await runComparison({
    settings,
    config,
    date: env.COMPARE_DATE || "2026-11-09",
    writers: list(env.COMPARE_WRITERS, DEFAULT_WRITERS),
    checker: env.COMPARE_CHECKER || DEFAULT_CHECKER,
    selector: env.COMPARE_SELECTOR || undefined,
    budgetUsd: env.COMPARE_BUDGET_USD ? Number(env.COMPARE_BUDGET_USD) : undefined,
    callTimeoutMs: Number(env.COMPARE_CALL_TIMEOUT_SECONDS || 240) * 1000,
    deadlineMs: Number(env.COMPARE_DEADLINE_SECONDS || 1500) * 1000,
  });
  const json = JSON.stringify(result, null, 2);
  if (env.COMPARE_FORMAT === "marker") {
    // One line, easy to pull out of mixed pod logs: grep "^COMPARE_RESULT_JSON " | cut -d" " -f2-
    process.stdout.write(`\nCOMPARE_RESULT_JSON ${JSON.stringify(result)}\n`);
  } else if (env.COMPARE_OUT) {
    writeFileSync(env.COMPARE_OUT, json + "\n", "utf8");
    process.stderr.write(`[compare] wrote ${env.COMPARE_OUT}\n`);
  } else {
    process.stdout.write(json + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`[compare] failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}

export { LLMError };
