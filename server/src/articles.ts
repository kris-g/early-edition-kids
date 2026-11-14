/** Parent-added articles (CONTRACT.md): search the 30-day archive, paste a URL, add to today or tomorrow. */

import { topicNames } from "./config.js";
import type { Row } from "./db.js";
import { utcnowIso } from "./db.js";
import { extractArticle, normaliseUrl, pageMeta, type Candidate } from "./feeds.js";
import { LLMUnavailable, stubGuessTopic } from "./llm.js";
import { appendStory, draftRow, monthlyLimitReached, produce, withLlms, type Context } from "./pipeline.js";
import { addDays, londonDate, longDate } from "./timeutil.js";
import { countWords } from "./validate.js";

export interface ArticleHit {
  url: string;
  source_name: string;
  title: string;
  summary: string;
  published_at: string | null;
  used_on: string | null;
  requested_for: string | null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function annotate(ctx: Context, rows: Row[]): ArticleHit[] {
  if (!rows.length) return [];
  const urls = rows.map((r) => r.url as string);
  const marks = urls.map(() => "?").join(",");
  const used = new Map<string, string>();
  for (const r of ctx.db.query(
    `SELECT source_url, MAX(issue_date) AS d FROM stories WHERE source_url IN (${marks}) GROUP BY source_url`,
    urls,
  )) {
    used.set(r.source_url, r.d);
  }
  const requested = new Map<string, string>();
  for (const r of ctx.db.query(`SELECT url, for_date FROM add_requests WHERE status = 'pending' AND url IN (${marks})`, urls)) {
    requested.set(r.url, r.for_date);
  }
  return rows.map((r) => ({
    url: r.url,
    source_name: r.source_name,
    title: r.title,
    summary: r.summary,
    published_at: r.published_at ?? null,
    used_on: used.get(r.url) ?? null,
    requested_for: requested.get(r.url) ?? null,
  }));
}

/** Keyword search over title and summary, newest first. An empty query lists the newest items. */
export function searchArchive(ctx: Context, query: string, limit = 40): ArticleHit[] {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
  const order = "ORDER BY COALESCE(a.published_at, a.fetched_at) DESC LIMIT ?";
  let rows: Row[];
  if (!tokens.length) {
    rows = ctx.db.query(`SELECT a.* FROM articles a ${order}`, [limit]);
  } else if (ctx.db.ftsEnabled) {
    const match = tokens.map((t) => `"${t}"*`).join(" ");
    rows = ctx.db.query(
      `SELECT a.* FROM articles_fts f JOIN articles a ON a.rowid = f.rowid WHERE articles_fts MATCH ? ${order}`,
      [match, limit],
    );
  } else {
    const where = tokens.map(() => "(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')").join(" AND ");
    const params = tokens.flatMap((t) => {
      const like = `%${t.replace(/[\\%_]/g, "\\$&")}%`;
      return [like, like];
    });
    rows = ctx.db.query(`SELECT a.* FROM articles a WHERE ${where} ${order}`, [...params, limit]);
  }
  return annotate(ctx, rows);
}

export interface AddResult {
  ok: boolean;
  when: "today" | "tomorrow";
  title: string;
  url: string;
  message: string;
  problems: string[];
  storyId?: number;
  requestId?: number;
}

interface Source {
  url: string;
  title: string;
  summary: string;
  sourceName: string;
  published: Date;
  html: string | null;
}

/** Resolve a URL to a source: the archive entry if we have it, else the page's own metadata. */
async function resolveSource(ctx: Context, rawUrl: string, now: Date): Promise<Source> {
  const url = normaliseUrl(rawUrl);
  const archived = ctx.db.queryOne("SELECT * FROM articles WHERE url = ?", [url]);
  if (archived) {
    return {
      url,
      title: archived.title,
      summary: archived.summary || "",
      sourceName: archived.source_name,
      published: archived.published_at ? new Date(archived.published_at) : now,
      html: null,
    };
  }
  const html = await ctx.pageFetcher(url);
  const meta = pageMeta(html);
  return {
    url,
    title: meta.title || new URL(url).hostname,
    summary: meta.summary,
    sourceName: meta.siteName || new URL(url).hostname.replace(/^www\./, ""),
    published: now,
    html,
  };
}

function defaultTopic(ctx: Context, source: Source, chosen: string | undefined): string {
  const names = topicNames(ctx.config);
  if (chosen && names.includes(chosen)) return chosen;
  const hint = ctx.config.feeds.find((f) => f.name === source.sourceName)?.topicHint;
  if (hint && names.includes(hint)) return hint;
  return stubGuessTopic(source.title, source.summary, names);
}

function candidateFor(source: Source): Candidate {
  return {
    id: 0,
    title: source.title,
    summary: source.summary,
    url: source.url,
    sourceName: source.sourceName,
    kidsSource: false,
    topicHint: null,
    published: source.published,
    contentHtml: null,
  };
}

/**
 * Add an article for today (rewrite and check now, append to the current version) or tomorrow
 * (store a request the next generation includes as a pick). Checks are never bypassed.
 */
export async function addArticle(
  ctx: Context,
  opts: { url: string; when: "today" | "tomorrow"; topic?: string; now: Date; jobId?: string },
): Promise<AddResult> {
  const { when, now } = opts;
  const fail = (title: string, message: string, problems: string[] = []): AddResult => ({
    ok: false,
    when,
    title,
    url: opts.url,
    message,
    problems,
  });
  if (!isHttpUrl(opts.url)) return fail("", "That is not a web address (it must start with http:// or https://).");
  const today = londonDate(now);
  const limit = monthlyLimitReached(ctx, now);
  if (limit) {
    return fail("", "Monthly AI limit reached, so no more articles can be added this month. You can raise the limit in the AI settings.", [limit]);
  }

  let source: Source;
  try {
    source = await resolveSource(ctx, opts.url, now);
  } catch (err) {
    return fail("", "The page could not be fetched.", [String(err)]);
  }
  // Reuse the page we already fetched for metadata.
  const pageFetcher = source.html !== null ? async () => source.html! : ctx.pageFetcher;
  const scoped: Context = { ...ctx, pageFetcher, scope: { runId: null, jobId: opts.jobId ?? null, stage: "add", at: now } };
  const topic = defaultTopic(ctx, source, opts.topic);

  if (when === "tomorrow") {
    const forDate = addDays(today, 1);
    const pending = ctx.db.queryOne("SELECT id FROM add_requests WHERE url = ? AND status = 'pending'", [source.url]);
    if (pending) return fail(source.title, "This article is already waiting to be added.");
    let words = 0;
    try {
      words = countWords(await extractArticle(candidateFor(source), pageFetcher, ctx.config.sourceCharLimit));
    } catch (err) {
      return fail(source.title, "The article could not be read.", [String(err)]);
    }
    if (words < ctx.config.minSourceWords) {
      return fail(source.title, "Not enough of the article could be read to write a story.", [
        `only ${words} words of article text could be read; at least ${ctx.config.minSourceWords} are needed`,
      ]);
    }
    const id = ctx.db.run(
      "INSERT INTO add_requests (url, source_name, title, summary, topic, for_date, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [source.url, source.sourceName, source.title, source.summary, opts.topic && opts.topic !== "" ? topic : null, forDate, utcnowIso(now)],
    ).lastId;
    return {
      ok: true,
      when,
      title: source.title,
      url: source.url,
      message: `Saved for ${longDate(forDate)}. It will be rewritten and checked with the rest of that issue, and replaces one of the usual picks.`,
      problems: [],
      requestId: id,
    };
  }

  // Today: rewrite and check now, then append to today's current version.
  return ctx.lock.run(async () => {
    const issue = ctx.db.getIssue(today);
    if (!issue) {
      return fail(source.title, "Today's issue has not been made yet. Make it first, or add this for tomorrow.");
    }
    const already = ctx.db.queryOne("SELECT id FROM stories WHERE issue_date = ? AND issue_version = ? AND source_url = ?", [
      today,
      Number(issue.version),
      source.url,
    ]);
    if (already) return fail(source.title, "This article is already in today's issue.");

    const detail: string[] = [];
    let outcome;
    try {
      outcome = await produce(withLlms(scoped), candidateFor(source), topic, topicNames(ctx.config), longDate(today), null, detail);
    } catch (err) {
      if (err instanceof LLMUnavailable) return fail(source.title, "The writer could not be reached.", [err.message]);
      throw err;
    }
    for (const line of detail) console.log(`parent add: ${line}`);
    if (!outcome.draft) {
      return fail(source.title, "The story did not pass the checks, so it was not added.", outcome.problems);
    }
    outcome.draft.addedBy = "parent";
    const added = appendStory(ctx, today, draftRow(outcome.draft));
    return {
      ok: true,
      when,
      title: outcome.draft.story.title,
      url: source.url,
      message: `Added to today's issue as story ${added.position}. The Kindle picks it up at its next check.`,
      problems: [],
      storyId: added.id,
    };
  });
}

export function recentRequests(ctx: Context, now: Date): Row[] {
  return ctx.db.query(
    "SELECT * FROM add_requests WHERE status = 'pending' OR (status IN ('added', 'failed') AND requested_at >= ?) ORDER BY id DESC LIMIT 20",
    [utcnowIso(new Date(now.getTime() - 3 * 86400_000))],
  );
}
