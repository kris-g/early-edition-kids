/**
 * The daily generation pipeline (DESIGN 4.1): fetch -> filter -> select -> extract -> rewrite -> check -> store.
 *
 * Everything here is async and only does short synchronous work (SQLite calls, parsing a feed), so
 * the event loop, and /healthz, keep answering while a run waits on the LLM.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { issuesDir, topicNames, type Config, type Settings } from "./config.js";
import { utcnowIso, type Database, type Row } from "./db.js";
import {
  extractArticle,
  fetchAll,
  filterCandidates,
  httpFetchFeed,
  httpFetchText,
  isExcluded,
  newReport,
  normaliseTitle,
  normaliseUrl,
  promptCandidate,
  reportSummary,
  type Candidate,
  type FeedFetcher,
  type FeedItem,
  type PageFetcher,
} from "./feeds.js";
import { settingsForLlms, effectiveAiSettings } from "./aisettings.js";
import {
  LLMError,
  LLMRefusal,
  LLMUnavailable,
  buildLlms,
  parseJsonObject,
  stubGuessTopic,
  type AnthropicClientLike,
  type CallUsage,
  type LLM,
} from "./llm.js";
import { markOutcome, monthToDateCost, recordCall, type Stage, type UsageScope } from "./usage.js";
import { CHECK_SCHEMA, rewriteSchema, selectSchema } from "./schemas.js";
import * as prompts from "./prompts.js";
import { bodyToHtml, renderStory } from "./render.js";
import { addDays, generationNow, longDate } from "./timeutil.js";
import { countWords, parseVerdict, storyWordCount, validateStory, type Story } from "./validate.js";
import { minutesFor, storyStats, topicStats, type TopicStat } from "./weights.js";

export const MIN_STORIES = 3;
export const ARCHIVE_DAYS = 30;

/** Serialises generation and parent adds, so only one of them changes an issue at a time. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  busy = false;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
      release();
    }
  }
}

class Semaphore {
  private waiting: Array<() => void> = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.waiting.push(r));
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export interface Context {
  settings: Settings;
  config: Config;
  db: Database;
  writer: LLM | null;
  checker: LLM | null;
  llmSetupError: string | null;
  feedFetcher: FeedFetcher;
  pageFetcher: PageFetcher;
  lock: Mutex;
  /** True when the LLM clients were injected (tests); otherwise they are rebuilt per run from the AI settings. */
  llmFixed: boolean;
  /** Tests can inject a mock Anthropic SDK client used when the clients are built from settings. */
  anthropicClient?: AnthropicClientLike;
  /** Tests can inject a mock fetch for OpenRouter. */
  openrouterFetch?: typeof fetch;
  /** The run or job LLM usage is recorded against. */
  scope: UsageScope;
}

export function buildContext(
  settings: Settings,
  config: Config,
  db: Database,
  extra: Partial<Pick<Context, "writer" | "checker" | "feedFetcher" | "pageFetcher" | "anthropicClient" | "openrouterFetch">> = {},
): Context {
  const ctx: Context = {
    settings,
    config,
    db,
    writer: extra.writer ?? null,
    checker: extra.checker ?? null,
    llmSetupError: null,
    feedFetcher: extra.feedFetcher ?? httpFetchFeed,
    pageFetcher: extra.pageFetcher ?? httpFetchText,
    lock: new Mutex(),
    llmFixed: Boolean(extra.writer),
    anthropicClient: extra.anthropicClient,
    openrouterFetch: extra.openrouterFetch,
    scope: { runId: null, jobId: null },
  };
  if (!ctx.writer) {
    try {
      [ctx.writer, ctx.checker] = buildLlms(settingsForLlms(settings, db, injected(ctx)), clients(ctx));
    } catch (err) {
      ctx.llmSetupError = err instanceof Error ? err.message : String(err);
    }
  }
  if (!ctx.checker) ctx.checker = ctx.writer;
  return ctx;
}

export interface GenerateResult {
  date: string;
  version: number | null;
  fallback: boolean;
  story_count: number;
  status: "created" | "exists" | "failed";
  detail: string[];
}

export const resultApi = (r: GenerateResult) => ({
  date: r.date,
  version: r.version,
  fallback: r.fallback,
  story_count: r.story_count,
  status: r.status,
});

export interface Draft {
  story: Story;
  candidate: Candidate;
  sourceText: string;
  addedBy: string | null;
  requestId: number | null;
}

// ---- public entry point ----

/**
 * Build the issue for `target` (YYYY-MM-DD). Serialised by ctx.lock so concurrent calls are safe:
 * a second caller waits and then sees "exists" (unless it forces a new version).
 */
export function generate(ctx: Context, target: string, now: Date, force = false): Promise<GenerateResult> {
  return ctx.lock.run(() => generateLocked(ctx, target, now, force));
}

async function generateLocked(ctx: Context, date: string, now: Date, force: boolean): Promise<GenerateResult> {
  const existing = ctx.db.getIssue(date);
  if (existing && !force) {
    return {
      date,
      version: Number(existing.version),
      fallback: Boolean(existing.fallback),
      story_count: Number(existing.story_count),
      status: "exists",
      detail: [],
    };
  }

  const runId = ctx.db.startRun(date);
  const detail: string[] = [`run for ${date} (force=${force ? "True" : "False"})`];
  // AI settings are read once here, so a change applies from the next run, never mid-run.
  const runCtx = withLlms({ ...ctx, scope: { runId, jobId: null, at: now } }, detail);
  const limit = monthlyLimitReached(ctx, now);
  if (limit) detail.push(limit);
  const requests = requestsFor(ctx.db, date);
  if (requests.length) detail.push(`parent requests: ${requests.map((r) => `#${r.id} ${r.title}`).join("; ")}`);
  let drafts: Draft[] = [];
  const failedRequests = new Map<number, string[]>();
  try {
    drafts = await buildFresh(runCtx, date, generationNow(date, now), detail, requests, failedRequests, now, limit);
  } catch (err) {
    if (err instanceof LLMUnavailable) detail.push(`LLM unavailable: ${err.message}`);
    else {
      console.error("generation failed", err);
      detail.push(`pipeline error: ${String(err)}`);
    }
  }

  let result: GenerateResult;
  if (drafts.length >= MIN_STORIES) {
    result = publishFresh(ctx, date, drafts);
    detail.push(`published ${result.story_count} stories as v${result.version}`);
    updateRequests(ctx.db, date, drafts, failedRequests);
  } else if (existing) {
    // A forced run that fails never replaces a good issue with a worse one.
    detail.push(`only ${drafts.length} stories passed; kept existing v${existing.version}`);
    result = {
      date,
      version: Number(existing.version),
      fallback: Boolean(existing.fallback),
      story_count: Number(existing.story_count),
      status: "failed",
      detail: [],
    };
    updateRequests(ctx.db, date, [], failedRequests);
  } else {
    detail.push(`only ${drafts.length} stories passed; trying catch-up fallback`);
    result = publishFallback(ctx, date, detail);
    updateRequests(ctx.db, date, [], failedRequests);
  }

  result.detail = detail;
  const runStatus = result.fallback && result.status === "created" ? "fallback" : result.status;
  ctx.db.finishRun(runId, runStatus, detail);
  for (const line of detail) console.log(line);
  return result;
}

// ---- LLM clients, usage and the monthly limit ----

/** Providers that count as configured because a test injected a client for them. */
export const injected = (ctx: Context) => ({ anthropic: Boolean(ctx.anthropicClient), openrouter: Boolean(ctx.openrouterFetch) });
const clients = (ctx: Context) => ({ anthropic: ctx.anthropicClient, openrouterFetch: ctx.openrouterFetch });

/** A copy of ctx with LLM clients built from the current AI settings (unless injected). */
export function withLlms(ctx: Context, detail?: string[]): Context {
  if (ctx.llmFixed) return ctx;
  try {
    const [writer, checker] = buildLlms(settingsForLlms(ctx.settings, ctx.db, injected(ctx)), clients(ctx));
    const ai = effectiveAiSettings(ctx.settings, ctx.db, injected(ctx));
    detail?.push(`ai: ${ai.provider} writer=${ai.writer_model} (${ai.writer_effort}) checker=${ai.check_model} (${ai.check_effort})`);
    return { ...ctx, writer, checker, llmSetupError: null };
  } catch (err) {
    return { ...ctx, writer: null, checker: null, llmSetupError: err instanceof Error ? err.message : String(err) };
  }
}

/** A run-log message when this month's LLM cost has reached the parent's limit, else null. */
export function monthlyLimitReached(ctx: Context, now: Date): string | null {
  const limit = effectiveAiSettings(ctx.settings, ctx.db, injected(ctx)).monthly_limit_usd;
  if (limit === null) return null;
  const spent = monthToDateCost(ctx.db, now);
  return spent >= limit ? `monthly AI limit reached ($${spent.toFixed(2)} of $${limit.toFixed(2)} this month)` : null;
}

/** Record one LLM response against the current run or job; returns the call id. */
function record(ctx: Context, stage: Stage, u: CallUsage): number | null {
  try {
    return recordCall(ctx.db, ctx.config, ctx.scope, stage, u);
  } catch (err) {
    console.error("could not record LLM usage", err);
    return null;
  }
}

// ---- archive (CONTRACT.md "Parent-added articles") ----

/** Archive fetched items for parent search. Non-articles (the feed exclude patterns: videos, podcasts, quizzes) are skipped, since they cannot be rewritten into a story. */
export function archiveItems(db: Database, items: FeedItem[], now: Date): void {
  const fetchedAt = utcnowIso(now);
  db.transaction(() => {
    const stmt = db.db.prepare(
      "INSERT INTO articles (url, source_name, title, summary, published_at, fetched_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(url) DO UPDATE SET source_name = excluded.source_name, title = excluded.title, " +
        "summary = excluded.summary, published_at = COALESCE(excluded.published_at, articles.published_at), " +
        "fetched_at = excluded.fetched_at",
    );
    for (const it of items) {
      if (isExcluded(it)) continue;
      stmt.run(normaliseUrl(it.url), it.feed.name, it.title, it.summary, it.published ? utcnowIso(it.published) : null, fetchedAt);
    }
    db.db
      .prepare("DELETE FROM articles WHERE fetched_at < ?")
      .run(utcnowIso(new Date(now.getTime() - ARCHIVE_DAYS * 86400_000)));
  });
}

// ---- parent requests for a date ----

/** Pending requests due by `date`, plus ones already used for `date` (so a regenerate keeps them). */
export function requestsFor(db: Database, date: string): Row[] {
  return db.query(
    "SELECT * FROM add_requests WHERE (status = 'pending' AND for_date <= ?) OR (status = 'added' AND used_date = ?) ORDER BY id",
    [date, date],
  );
}

function updateRequests(db: Database, date: string, drafts: Draft[], failed: Map<number, string[]>): void {
  db.transaction(() => {
    for (const [id, reasons] of failed) {
      db.run("UPDATE add_requests SET status = 'failed', used_date = ?, detail = ? WHERE id = ?", [date, reasons.join("\n"), id]);
    }
  });
  // Story ids are only known after storing, so look them up by URL in the new version.
  const issue = db.getIssue(date);
  if (!issue || !drafts.some((d) => d.requestId !== null)) return;
  const rows = db.storiesFor(date, Number(issue.version));
  db.transaction(() => {
    for (const d of drafts) {
      if (d.requestId === null) continue;
      const row = rows.find((r) => r.source_url === d.candidate.url);
      db.run("UPDATE add_requests SET status = 'added', used_date = ?, story_id = ?, detail = '' WHERE id = ?", [
        date,
        row ? Number(row.id) : null,
        d.requestId,
      ]);
    }
  });
}

function requestCandidate(r: Row, id: number, config: Config): Candidate {
  const feed = config.feeds.find((f) => f.name === r.source_name);
  return {
    id,
    title: r.title,
    summary: r.summary || "",
    url: r.url,
    sourceName: r.source_name,
    kidsSource: feed?.kidsSource ?? false,
    topicHint: feed?.topicHint ?? null,
    published: new Date(r.requested_at),
    contentHtml: null,
  };
}

// ---- fresh issue ----

function recentUsed(db: Database, target: string, days: number): { urls: Set<string>; titles: Set<string> } {
  const rows = db.query("SELECT source_url, source_title FROM stories WHERE issue_date >= ? AND issue_date < ?", [
    addDays(target, -days),
    target,
  ]);
  return {
    urls: new Set(rows.map((r) => r.source_url)),
    titles: new Set(rows.filter((r) => r.source_title).map((r) => normaliseTitle(r.source_title))),
  };
}

async function buildFresh(
  ctx: Context,
  target: string,
  now: Date,
  detail: string[],
  requests: Row[],
  failedRequests: Map<number, string[]>,
  realNow: Date,
  limitReached: string | null = null,
): Promise<Draft[]> {
  const cfg = ctx.config;
  const items = await fetchAll(cfg.feeds, ctx.feedFetcher, detail);
  try {
    archiveItems(ctx.db, items, realNow);
  } catch (err) {
    detail.push(`archive update failed: ${String(err)}`);
  }
  if (limitReached) throw new LLMUnavailable(limitReached);
  if (!ctx.writer) throw new LLMUnavailable(ctx.llmSetupError || "no LLM configured");

  const { urls, titles } = recentUsed(ctx.db, target, cfg.dedupeDays);
  const report = newReport();
  const requestUrls = new Set(requests.map((r) => r.url as string));
  const candidates = filterCandidates(items, {
    now,
    config: cfg,
    recentUrls: urls,
    recentTitles: titles,
    skipUrls: requestUrls,
    report,
  });
  detail.push(reportSummary(report));

  const overrides = ctx.db.topicOverrides();
  const tstats = topicStats(cfg, overrides, storyStats(ctx.db, cfg, target));
  const allowed = tstats.filter((t) => t.mode !== "block").map((t) => t.name);
  if (!allowed.length) {
    detail.push("every topic is blocked");
    return [];
  }
  const todayLong = longDate(target);

  const requested: Array<[Candidate, string, number]> = requests.slice(0, cfg.storyCount).map((r, i) => {
    const c = requestCandidate(r, candidates.length + i + 1, cfg);
    const topic = r.topic && topicNames(cfg).includes(r.topic) ? r.topic : stubGuessTopic(c.title, c.summary, topicNames(cfg));
    return [c, topic, Number(r.id)];
  });
  const selectCount = cfg.storyCount - requested.length;
  const queue = candidates.length ? await selectStories(ctx, candidates, tstats, allowed, todayLong, detail, selectCount) : [];
  if (!queue.length && !requested.length) return [];

  const sem = new Semaphore(cfg.llmConcurrency);
  const state: { down: string | null } = { down: null };
  type Slot = { cand: Candidate; topic: string; requestId: number | null };
  const picks: Slot[] = [
    ...requested.map(([cand, topic, requestId]) => ({ cand, topic, requestId })),
    ...queue.slice(0, Math.max(0, selectCount)).map(([cand, topic]) => ({ cand, topic, requestId: null })),
  ];
  const reserves: Slot[] = queue.slice(Math.max(0, selectCount)).map(([cand, topic]) => ({ cand, topic, requestId: null }));

  const fillSlot = async (first: Slot): Promise<Draft | null> => {
    let current: Slot | undefined = first;
    while (current) {
      if (state.down) return null;
      const isRequest = current.requestId !== null;
      // Parent picks may use any configured topic: blocking is about his feed, not the parent's choice.
      const topics = isRequest ? topicNames(cfg) : allowed;
      let outcome: ProduceOutcome;
      try {
        outcome = await produce(ctx, current.cand, current.topic, topics, todayLong, sem, detail);
      } catch (err) {
        if (err instanceof LLMUnavailable) {
          state.down = err.message;
          detail.push(`LLM became unavailable: ${err.message}`);
          return null;
        }
        throw err;
      }
      if (outcome.draft) {
        outcome.draft.addedBy = isRequest ? "parent" : null;
        outcome.draft.requestId = current.requestId;
        return outcome.draft;
      }
      if (isRequest) failedRequests.set(current.requestId!, outcome.problems);
      current = reserves.shift();
      if (current) detail.push(`using reserve [${current.cand.id}] ${JSON.stringify(current.cand.title)}`);
    }
    return null;
  };

  const results = await Promise.all(picks.map(fillSlot));
  const drafts = results.filter((d): d is Draft => d !== null);
  if (state.down && drafts.length < MIN_STORIES) throw new LLMUnavailable(state.down);
  return drafts;
}

/** The select step (DESIGN 4.1 step 3). Exported for the model comparison harness. */
export async function selectStories(
  ctx: Context,
  candidates: Candidate[],
  tstats: TopicStat[],
  allowed: string[],
  todayLong: string,
  detail: string[],
  storyCount: number,
): Promise<Array<[Candidate, string]>> {
  const cfg = ctx.config;
  const context = {
    child_age: cfg.childAge,
    story_count: storyCount,
    reserves: cfg.reserves,
    today_long: todayLong,
    topics: tstats.map((t) => ({ name: t.name, weight: t.weight, mode: t.mode, notes: t.notes })),
    pinned: tstats.filter((t) => t.mode === "pin").map((t) => t.name),
    blocked: tstats.filter((t) => t.mode === "block").map((t) => t.name),
    favourite_players: cfg.favouritePlayers,
    favourite_team: cfg.favouriteTeam,
    rival_clubs: cfg.rivalClubs,
    mens_football_only: cfg.mensFootballOnly,
    candidates: candidates.map(promptCandidate),
  };
  const msgs = prompts.messages("select", context);
  const stubContext = {
    candidates,
    allowedTopics: allowed,
    weights: Object.fromEntries(tstats.map((t) => [t.name, t.weight])),
    storyCount,
    reserves: cfg.reserves,
  };
  let data: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await ctx.writer!.chat(msgs, {
        task: "select",
        context: stubContext,
        schema: selectSchema(allowed),
        log: (line) => detail.push(line),
        onUsage: (u) => record(ctx, "select", u),
      });
      data = parseJsonObject(reply);
      break;
    } catch (err) {
      if (!(err instanceof LLMError)) throw err;
      detail.push(`select reply unusable (attempt ${attempt + 1}): ${(err as Error).message}`);
    }
  }
  if (!data) return [];

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const chosen: Array<[Candidate, string]> = [];
  const seen = new Set<number>();
  for (const key of ["picks", "reserves"]) {
    const entries = Array.isArray(data[key]) ? data[key] : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const cid = Number.parseInt(String(entry.candidate_id), 10);
      if (!Number.isFinite(cid)) continue;
      const cand = byId.get(cid);
      if (!cand || seen.has(cid)) continue;
      let topic: string | null = typeof entry.topic === "string" && allowed.includes(entry.topic) ? entry.topic : null;
      if (topic === null) topic = cand.topicHint && allowed.includes(cand.topicHint) ? cand.topicHint : null;
      if (topic === null) {
        detail.push(`select: dropped [${cid}], topic ${JSON.stringify(entry.topic)} not allowed`);
        continue;
      }
      seen.add(cid);
      chosen.push([cand, topic]);
    }
  }
  detail.push("selected: " + chosen.map(([c, t]) => `[${c.id}] ${t}: ${c.title}`).join("; "));
  return chosen.slice(0, storyCount + cfg.reserves);
}

/** Everything the rewrite prompt sees for one candidate (the source text is the extracted article). */
export function rewritePromptContext(cfg: Config, cand: Candidate, topic: string, allowed: string[], todayLong: string, article: string) {
  return {
    child_age: cfg.childAge,
    topics: allowed,
    today_long: todayLong,
    published_long: longDate(cand.published),
    topic,
    source_name: cand.sourceName,
    source_url: cand.url,
    source_title: cand.title,
    source_summary: cand.summary,
    source_text: article,
    favourite_players: cfg.favouritePlayers,
    favourite_team: cfg.favouriteTeam,
    rival_clubs: cfg.rivalClubs,
    mens_football_only: cfg.mensFootballOnly,
    words_min: cfg.storyWords.min,
    words_max: cfg.storyWords.max,
  };
}

/** The text the number check compares against: headline, summary and article. */
export const sourceTextFor = (cand: Candidate, article: string) => `${cand.title}\n\n${cand.summary}\n\n${article}`;

/** The checker's messages for one finished story. */
export function checkMessages(cfg: Config, cand: Candidate, article: string, story: Story, todayLong: string = longDate(new Date())) {
  return prompts.messages("check", {
    today_long: todayLong,
    published_long: longDate(cand.published),
    child_age: cfg.childAge,
    favourite_team: cfg.favouriteTeam,
    rival_clubs: cfg.rivalClubs,
    mens_football_only: cfg.mensFootballOnly,
    source_title: cand.title,
    source_summary: cand.summary,
    source_text: article,
    story,
  });
}

export interface ProduceOutcome {
  draft: Draft | null;
  /** Why the candidate was not usable (for a parent add, shown on the dashboard). */
  problems: string[];
}

/** Extract, rewrite and check one candidate (DESIGN 4.1 steps 4 to 6). Throws LLMUnavailable. */
export async function produce(
  ctx: Context,
  cand: Candidate,
  topic: string,
  allowed: string[],
  todayLong: string,
  sem: { run<T>(fn: () => Promise<T>): Promise<T> } | null,
  detail: string[],
): Promise<ProduceOutcome> {
  const cfg = ctx.config;
  const limit = sem ?? { run: <T>(fn: () => Promise<T>) => fn() };
  if (!ctx.writer || !ctx.checker) throw new LLMUnavailable(ctx.llmSetupError || "no LLM configured");
  let article: string;
  try {
    article = await extractArticle(cand, ctx.pageFetcher, cfg.sourceCharLimit);
  } catch (err) {
    detail.push(`[${cand.id}] extract failed: ${String(err)}`);
    return { draft: null, problems: [`could not read the article: ${String(err)}`] };
  }
  const words = countWords(article);
  if (words < cfg.minSourceWords) {
    detail.push(`[${cand.id}] dropped: only ${words} words of article text`);
    return { draft: null, problems: [`only ${words} words of article text could be read; at least ${cfg.minSourceWords} are needed`] };
  }

  const sourceText = sourceTextFor(cand, article);
  const base = rewritePromptContext(cfg, cand, topic, allowed, todayLong, article);
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs = prompts.messages("rewrite", { ...base, problems });
    const log = (line: string) => detail.push(`[${cand.id}] ${line}`);
    let data: Record<string, any>;
    try {
      const reply = await limit.run(() =>
        ctx.writer!.chat(msgs, {
          task: "rewrite",
          context: { candidate: cand, topic, sourceText, allowedTopics: allowed, storyWords: cfg.storyWords },
          schema: rewriteSchema(allowed),
          log,
          onUsage: (u) => record(ctx, "rewrite", u),
        }),
      );
      data = parseJsonObject(reply);
    } catch (err) {
      if (err instanceof LLMRefusal) {
        // A decline is about the article itself: drop it, never retry or publish it.
        detail.push(`[${cand.id}] writer declined: ${err.message}; dropped`);
        return { draft: null, problems: [`the writer declined this article (${err.category ?? "no category given"})`] };
      }
      if (!(err instanceof LLMError)) throw err;
      problems = [`the previous reply could not be used (${(err as Error).message})`];
      detail.push(`[${cand.id}] attempt ${attempt + 1}: unparseable reply`);
      continue;
    }
    const result = validateStory(data, {
      sourceText,
      sourceUrl: cand.url,
      allowedTopics: allowed,
      blocklist: cfg.blocklist,
      words: cfg.storyWords,
    });
    if (!result.ok) {
      problems = result.errors;
      detail.push(`[${cand.id}] attempt ${attempt + 1} failed validation: ${result.errors.join("; ")}`);
      continue;
    }
    const story = result.story!;
    const checkMsgs = checkMessages(cfg, cand, article, story, todayLong);
    let verdict;
    let checkCall: number | null = null;
    try {
      const verdictReply = await limit.run(() =>
        ctx.checker!.chat(checkMsgs, {
          task: "check",
          context: { story, sourceText, candidate: cand },
          schema: CHECK_SCHEMA,
          log,
          onUsage: (u) => {
            checkCall = record(ctx, "check", u);
          },
        }),
      );
      verdict = parseVerdict(parseJsonObject(verdictReply));
    } catch (err) {
      if (err instanceof LLMRefusal) {
        detail.push(`[${cand.id}] checker declined: ${err.message}; dropped`);
        return { draft: null, problems: [`the checker declined to review it (${err.category ?? "no category given"})`] };
      }
      if (!(err instanceof LLMError)) throw err;
      detail.push(`[${cand.id}] checker reply unusable: ${(err as Error).message}`);
      problems = ["the checker's reply could not be read"];
      continue;
    }
    markOutcome(ctx.db, checkCall, verdict.safe && verdict.supported ? "pass" : "sent_back");
    if (!verdict.safe) {
      // Unsafe means the subject itself is wrong for him: drop without a rewrite.
      const why = verdict.reasons.join("; ") || "no reason given";
      detail.push(`[${cand.id}] checker: not safe (${why}); dropped`);
      return { draft: null, problems: [`the checker marked it not safe for him: ${why}`] };
    }
    if (!verdict.supported) {
      problems = [`the checker found claims not supported by the source: ${verdict.reasons.join("; ")}`];
      detail.push(`[${cand.id}] attempt ${attempt + 1} checker: not supported (${verdict.reasons.join("; ")})`);
      continue;
    }
    detail.push(`[${cand.id}] passed: ${JSON.stringify(story.title)} (${storyWordCount(story)} words)`);
    return { draft: { story, candidate: cand, sourceText, addedBy: null, requestId: null }, problems: [] };
  }
  detail.push(`[${cand.id}] dropped after 2 attempts`);
  return { draft: null, problems };
}

// ---- storing ----

export const storyPath = (date: string, version: number, position: number) => `/issues/${date}/v${version}/${position}.html`;
export const storyFile = (settings: Settings, date: string, version: number, position: number) =>
  path.join(issuesDir(settings), date, `v${version}`, `${position}.html`);

export interface StoryRow {
  topic: string;
  title: string;
  teaser: string;
  body_html: string;
  word_to_know: string | null;
  think_about_it: string;
  source_name: string;
  source_url: string;
  source_title: string | null;
  word_count: number;
  reused_from: number | null;
  added_by: string | null;
}

export function draftRow(d: Draft): StoryRow {
  const s = d.story;
  return {
    topic: s.topic,
    title: s.title,
    teaser: s.teaser,
    body_html: bodyToHtml(s.body, s.word_to_know),
    word_to_know: s.word_to_know ? JSON.stringify(s.word_to_know) : null,
    think_about_it: s.think_about_it,
    source_name: d.candidate.sourceName,
    source_url: d.candidate.url,
    source_title: d.candidate.title,
    word_count: storyWordCount(s),
    reused_from: null,
    added_by: d.addedBy,
  };
}

function nextVersion(db: Database, date: string): number {
  const row = db.queryOne(
    "SELECT MAX(v) AS v FROM (SELECT version AS v FROM issues WHERE date = ? UNION ALL SELECT issue_version AS v FROM stories WHERE issue_date = ?)",
    [date, date],
  );
  return Number(row?.v ?? 0) + 1;
}

/** Insert one story row at a position and write its HTML file. Call inside a transaction. */
function insertStory(ctx: Context, date: string, version: number, position: number, row: StoryRow, at?: Date): number {
  const createdAt = utcnowIso(at);
  const id = ctx.db.run(
    "INSERT INTO stories (issue_date, issue_version, position, topic, title, teaser, body_html, word_to_know, " +
      "think_about_it, source_name, source_url, source_title, word_count, reused_from, hidden, created_at, added_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [
      date,
      version,
      position,
      row.topic,
      row.title,
      row.teaser,
      row.body_html,
      row.word_to_know,
      row.think_about_it,
      row.source_name,
      row.source_url,
      row.source_title,
      row.word_count,
      row.reused_from,
      createdAt,
      row.added_by,
    ],
  ).lastId;
  const file = storyFile(ctx.settings, date, version, position);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderStory(row as unknown as Row, ctx.config.readingWpm), "utf8");
  return id;
}

/** Rewrite index.json for one version from the database (all stories, as stored). */
export function writeIndex(ctx: Context, date: string, version: number): void {
  const issue = ctx.db.getIssue(date);
  const stories = ctx.db.storiesFor(date, version).map((r) => ({
    id: Number(r.id),
    position: Number(r.position),
    topic: r.topic,
    title: r.title,
    teaser: r.teaser,
    minutes: minutesFor(Number(r.word_count), ctx.config.readingWpm),
    path: storyPath(date, version, Number(r.position)),
  }));
  const index = { date, version, fallback: Boolean(issue?.fallback), title: ctx.config.title, stories };
  const file = path.join(issuesDir(ctx.settings), date, `v${version}`, "index.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(index, null, 2), "utf8");
}

/** Insert the issue version and its stories, write the HTML files and index. Returns the version. */
/** `at` sets created_at (for importing a past issue); normal runs store now. */
export function storeIssue(ctx: Context, date: string, rows: StoryRow[], fallback: boolean, at?: Date): number {
  return ctx.db.transaction(() => {
    const version = nextVersion(ctx.db, date);
    ctx.db.run(
      "INSERT INTO issues (date, version, created_at, fallback, story_count) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(date) DO UPDATE SET version = excluded.version, created_at = excluded.created_at, " +
        "fallback = excluded.fallback, story_count = excluded.story_count",
      [date, version, utcnowIso(at), fallback ? 1 : 0, rows.length],
    );
    rows.forEach((row, i) => insertStory(ctx, date, version, i + 1, row, at));
    writeIndex(ctx, date, version);
    return version;
  });
}

/** Append a story to the current version of an existing issue (parent "Add to today"). */
export function appendStory(ctx: Context, date: string, row: StoryRow): { id: number; version: number; position: number } {
  return ctx.db.transaction(() => {
    const issue = ctx.db.getIssue(date);
    if (!issue) throw new Error(`no issue for ${date}`);
    const version = Number(issue.version);
    const max = ctx.db.queryOne("SELECT MAX(position) AS p FROM stories WHERE issue_date = ? AND issue_version = ?", [date, version]);
    const position = Number(max?.p ?? 0) + 1;
    const id = insertStory(ctx, date, version, position, row);
    ctx.db.run("UPDATE issues SET story_count = story_count + 1 WHERE date = ?", [date]);
    writeIndex(ctx, date, version);
    return { id, version, position };
  });
}

function publishFresh(ctx: Context, date: string, drafts: Draft[]): GenerateResult {
  const version = storeIssue(ctx, date, drafts.map(draftRow), false);
  return { date, version, fallback: false, story_count: drafts.length, status: "created", detail: [] };
}

// ---- catch-up fallback (DESIGN 4.4) ----

/** Stories from the last `days` days (current versions only) that no device opened, newest first. */
export function fallbackCandidates(db: Database, target: string, days: number, limit: number): Row[] {
  const rows = db.query(
    "SELECT s.* FROM stories s JOIN issues i ON i.date = s.issue_date AND i.version = s.issue_version " +
      "WHERE s.issue_date >= ? AND s.issue_date < ? ORDER BY s.issue_date DESC, s.position ASC",
    [addDays(target, -days), target],
  );
  const openedRoots = new Set(
    db
      .query(
        "SELECT DISTINCT COALESCE(s.reused_from, s.id) AS root FROM events e JOIN stories s ON s.id = e.story_id " +
          "WHERE e.type IN ('story_opened', 'story_closed')",
      )
      .map((r) => Number(r.root)),
  );
  const hiddenRoots = new Set(
    db.query("SELECT DISTINCT COALESCE(reused_from, id) AS root FROM stories WHERE hidden = 1").map((r) => Number(r.root)),
  );
  const out: Row[] = [];
  const seenRoots = new Set<number>();
  const seenUrls = new Set<string>();
  for (const r of rows) {
    const root = Number(r.reused_from ?? r.id);
    if (openedRoots.has(root) || hiddenRoots.has(root) || seenRoots.has(root) || seenUrls.has(r.source_url)) continue;
    seenRoots.add(root);
    seenUrls.add(r.source_url);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

function publishFallback(ctx: Context, date: string, detail: string[]): GenerateResult {
  const picks = fallbackCandidates(ctx.db, date, ctx.config.fallbackDays, ctx.config.storyCount);
  if (picks.length < MIN_STORIES) {
    detail.push(`catch-up: only ${picks.length} unopened stories; publishing nothing`);
    return { date, version: null, fallback: true, story_count: 0, status: "failed", detail: [] };
  }
  const rows: StoryRow[] = picks.map((p) => ({
    topic: p.topic,
    title: p.title,
    teaser: p.teaser,
    body_html: p.body_html,
    word_to_know: p.word_to_know,
    think_about_it: p.think_about_it,
    source_name: p.source_name,
    source_url: p.source_url,
    source_title: p.source_title,
    word_count: Number(p.word_count),
    reused_from: Number(p.reused_from ?? p.id),
    added_by: p.added_by ?? null,
  }));
  const version = storeIssue(ctx, date, rows, true);
  detail.push(`catch-up: reused stories [${rows.map((r) => r.reused_from).join(", ")}]`);
  return { date, version, fallback: true, story_count: rows.length, status: "created", detail: [] };
}

export { LLMError };
