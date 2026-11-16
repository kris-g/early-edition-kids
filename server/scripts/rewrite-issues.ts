/**
 * Rewrite existing papers with the current settings, as a new version of each date.
 *
 *   tsx scripts/rewrite-issues.ts --dates 2026-11-09,2026-11-10 [--dry-run] [--budget 5] [--profile younger]
 *
 * For each date: the latest version's visible stories, in position order, are rewritten from their
 * own source URLs with the pipeline's produce step (extract -> rewrite -> check, one retry), using
 * the current writer and checker models and efforts, prompts and word range. The result becomes
 * version+1 with the same order and topics; the parent-added and reused flags are kept. Hidden
 * stories are dropped. A story that still fails is carried over unchanged, so a paper never loses
 * stories. Each date gets a run row and its LLM calls. The events table is never touched. With several
 * profiles, --profile picks the child (default: the profile that owns the root data).
 */

import { pathToFileURL } from "node:url";
import { dbPath, settingsFromEnv, type Config, type Settings } from "../src/config.js";
import { profileFromArgs } from "../src/profiles.js";
import { Database, type Row } from "../src/db.js";
import { normaliseUrl, type Candidate } from "../src/feeds.js";
import { LLMUnavailable } from "../src/llm.js";
import {
  buildContext,
  draftRow,
  rowImageOf,
  monthlyLimitReached,
  produce,
  storeIssue,
  withLlms,
  type Context,
  type StoryRow,
} from "../src/pipeline.js";
import { isIsoDate, longDate } from "../src/timeutil.js";

/** Assumed cost of one story (rewrite + check, with a retry) before any has been measured. */
const FIRST_STORY_ESTIMATE_USD = 0.12;

export interface RewriteOptions {
  dates: string[];
  dryRun?: boolean;
  budgetUsd?: number;
  now?: Date;
  log?: (line: string) => void;
}

export interface DateResult {
  date: string;
  fromVersion: number | null;
  toVersion: number | null;
  status: "rewritten" | "refused" | "dry-run" | "nothing";
  reason?: string;
  rewritten: number;
  carried: number;
  dropped: number;
  cost_usd: number;
  lines: string[];
}

/** A stored story carried into the new version unchanged, photo and all. */
const rowFrom = (ctx: Context, s: Row): StoryRow => ({
  topic: s.topic,
  title: s.title,
  teaser: s.teaser,
  body_html: s.body_html,
  word_to_know: s.word_to_know,
  think_about_it: s.think_about_it,
  source_name: s.source_name,
  source_url: s.source_url,
  source_title: s.source_title,
  word_count: Number(s.word_count),
  reused_from: s.reused_from ?? null,
  added_by: s.added_by ?? null,
  image: rowImageOf(ctx.settings, s),
});

function candidateFor(ctx: Context, s: Row, date: string): Candidate {
  const url = normaliseUrl(s.source_url);
  const archived = ctx.db.queryOne("SELECT summary, published_at FROM articles WHERE url = ?", [url]);
  const published = archived?.published_at ? new Date(archived.published_at) : new Date(`${date}T06:00:00Z`);
  return {
    id: Number(s.position),
    title: s.source_title || s.title,
    summary: archived?.summary ?? "",
    url,
    sourceName: s.source_name,
    kidsSource: false,
    topicHint: null,
    published,
    contentHtml: null,
  };
}

const runCost = (ctx: Context, runId: number) =>
  Number(ctx.db.queryOne("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM llm_calls WHERE run_id = ?", [runId])?.c ?? 0);

export async function rewriteIssues(base: Context, o: RewriteOptions): Promise<DateResult[]> {
  const log = o.log ?? ((l: string) => process.stdout.write(l + "\n"));
  const budget = o.budgetUsd ?? 5;
  const words = base.config.storyWords;
  const results: DateResult[] = [];
  let spent = 0;
  let perStory = FIRST_STORY_ESTIMATE_USD;
  let stopped: string | null = null;

  for (const date of o.dates) {
    const r: DateResult = { date, fromVersion: null, toVersion: null, status: "nothing", rewritten: 0, carried: 0, dropped: 0, cost_usd: 0, lines: [] };
    results.push(r);
    const say = (line: string) => {
      r.lines.push(line);
      log(`${date} ${line}`);
    };
    const issue = isIsoDate(date) ? base.db.getIssue(date) : undefined;
    if (!issue) {
      r.status = "refused";
      r.reason = "no issue for this date";
      say(`refused: ${r.reason}`);
      continue;
    }
    const running = base.db.queryOne("SELECT id FROM runs WHERE issue_date = ? AND status = 'running' LIMIT 1", [date]);
    if (running) {
      r.status = "refused";
      r.reason = `a generation for this date is running (run ${running.id})`;
      say(`refused: ${r.reason}`);
      continue;
    }
    r.fromVersion = Number(issue.version);
    const all = base.db.storiesFor(date, r.fromVersion);
    const visible = all.filter((s) => !s.hidden);
    for (const s of all.filter((x) => x.hidden)) {
      r.dropped++;
      say(`drop hidden #${s.position}: ${JSON.stringify(s.title)}`);
    }
    if (o.dryRun) {
      r.status = "dry-run";
      r.toVersion = r.fromVersion + 1;
      say(`plan: v${r.fromVersion} -> v${r.toVersion}, rewrite ${visible.length} stories at ${words.min}-${words.max} words`);
      for (const s of visible) {
        const flags = [s.added_by === "parent" ? "added by parent" : "", s.reused_from ? `reused from ${s.reused_from}` : ""].filter(Boolean).join(", ");
        say(`  #${s.position} [${s.topic}] ${JSON.stringify(s.title)} <- ${s.source_url}${flags ? ` (${flags})` : ""}`);
      }
      continue;
    }
    if (stopped) {
      r.status = "refused";
      r.reason = stopped;
      say(`not started: ${stopped}`);
      continue;
    }

    const now = o.now ?? new Date();
    const runId = base.db.startRun(date);
    const detail: string[] = [`rewrite at ${words.min}–${words.max} words of v${r.fromVersion} (scripts/rewrite-issues.ts)`];
    const ctx = withLlms({ ...base, scope: { runId, jobId: null } }, detail);
    const rows: StoryRow[] = [];
    try {
      for (const s of visible) {
        const label = `#${s.position} ${JSON.stringify(s.title)}`;
        const limit = monthlyLimitReached(ctx, now);
        if (!stopped && limit) stopped = limit;
        if (!stopped && spent + perStory > budget) stopped = `budget of $${budget} would be passed ($${spent.toFixed(4)} spent)`;
        if (stopped || !ctx.writer) {
          rows.push(rowFrom(ctx, s));
          r.carried++;
          detail.push(`carried over ${label}: ${stopped ?? ctx.llmSetupError ?? "no LLM configured"}`);
          continue;
        }
        const before = runCost(ctx, runId);
        let outcome;
        try {
          outcome = await produce(ctx, candidateFor(ctx, s, date), s.topic, [s.topic], longDate(date), null, detail);
        } catch (err) {
          if (!(err instanceof LLMUnavailable)) throw err;
          stopped = `LLM unavailable: ${err.message}`;
          outcome = { draft: null, problems: [stopped] };
        }
        const cost = runCost(ctx, runId) - before;
        spent += cost;
        if (cost > 0) perStory = Math.max(perStory === FIRST_STORY_ESTIMATE_USD ? 0 : perStory, cost);
        if (outcome.draft) {
          const row = draftRow(outcome.draft);
          rows.push({
            ...row,
            topic: s.topic,
            reused_from: s.reused_from ?? null,
            added_by: s.added_by ?? null,
            // A new photo when one was found, else the story keeps the one it had.
            image: row.image ?? rowImageOf(ctx.settings, s),
          });
          r.rewritten++;
          detail.push(`rewritten ${label} -> ${JSON.stringify(row.title)} (${row.word_count} words, $${cost.toFixed(4)})`);
        } else {
          rows.push(rowFrom(ctx, s));
          r.carried++;
          detail.push(`failed, carried over unchanged ${label}: ${outcome.problems.join("; ")}`);
        }
      }
      for (const s of all.filter((x) => x.hidden)) detail.push(`dropped hidden #${s.position} ${JSON.stringify(s.title)}`);
      r.cost_usd = runCost(ctx, runId);
      if (r.rewritten === 0) {
        r.status = "nothing";
        r.reason = "no story was rewritten; the existing version is kept";
        detail.push(r.reason);
        ctx.db.finishRun(runId, "failed", detail);
      } else {
        r.toVersion = storeIssue(ctx, date, rows, Boolean(issue.fallback));
        r.status = "rewritten";
        detail.push(`published v${r.toVersion}: ${r.rewritten} rewritten, ${r.carried} carried over, ${r.dropped} hidden dropped ($${r.cost_usd.toFixed(4)})`);
        ctx.db.finishRun(runId, "created", detail);
      }
    } catch (err) {
      detail.push(`error: ${String(err)}`);
      ctx.db.finishRun(runId, "failed", detail);
      throw err;
    }
    for (const line of detail) say(line);
  }
  return results;
}

export function openContext(settings: Settings, config: Config, profileId?: string): Context {
  const db = new Database(dbPath(settings));
  db.init();
  return buildContext(settings, config, db, { profileId });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const dates = (arg("--dates") ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (!dates.length || dates.some((d) => !isIsoDate(d))) {
    process.stderr.write("usage: rewrite-issues.ts --dates YYYY-MM-DD[,YYYY-MM-DD...] [--dry-run] [--budget 5] [--profile <id>]\n");
    process.exit(2);
  }
  const profile = profileFromArgs(settingsFromEnv(), args);
  const ctx = openContext(profile.settings, profile.config, profile.id);
  try {
    const results = await rewriteIssues(ctx, {
      dates,
      dryRun: args.includes("--dry-run"),
      budgetUsd: arg("--budget") ? Number(arg("--budget")) : 5,
    });
    const total = results.reduce((n, r) => n + r.cost_usd, 0);
    process.stdout.write(
      `\n${results.map((r) => `${r.date}: ${r.status}${r.toVersion ? ` v${r.fromVersion}->v${r.toVersion}` : ""} rewritten=${r.rewritten} carried=${r.carried} dropped=${r.dropped} $${r.cost_usd.toFixed(4)}${r.reason ? ` (${r.reason})` : ""}`).join("\n")}\ntotal $${total.toFixed(4)}\n`,
    );
  } finally {
    ctx.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`rewrite-issues failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
