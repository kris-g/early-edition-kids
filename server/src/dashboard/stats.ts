/** Reading stats, calendar, run costs and the AI view (CONTRACT.md "Dashboard v2"). */

import { effectiveAiSettings } from "../aisettings.js";
import { PROVIDER_NAMES, catalog, configured, type ProviderId } from "../providers.js";
import { loadsJson, type Row } from "../db.js";
import { injected, type Context } from "../pipeline.js";
import { LONDON, addDays, londonDate } from "../timeutil.js";
import { callsInMonth } from "../usage.js";
import { storyStats } from "../weights.js";
import type {
  AiView,
  CalendarView,
  ModelOption,
  ReadingDay,
  ReadingView,
  RunCost,
  StageCost,
  Streak,
} from "./types.js";

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ---- reading events ----

export interface Closed {
  /** London date the server received it. */
  date: string;
  storyId: number;
  seconds: number;
  read: boolean;
}

const toInt = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Every story_closed event in the order received, dated by when the server received it (Europe/London). */
export function closedEvents(ctx: Context, from?: string, to?: string): Closed[] {
  const out: Closed[] = [];
  for (const e of ctx.db.query("SELECT story_id, received_at, payload_json FROM events WHERE type = 'story_closed' ORDER BY received_at, id")) {
    const at = new Date(e.received_at);
    if (Number.isNaN(at.getTime())) continue;
    const date = londonDate(at);
    if ((from && date < from) || (to && date > to)) continue;
    const p = loadsJson<Record<string, any>>(e.payload_json, {}) ?? {};
    const total = toInt(p.pages_total);
    const read = p.finished === true || (total > 0 && toInt(p.max_page) >= total);
    out.push({ date, storyId: Number(e.story_id), seconds: Math.max(0, toInt(p.active_seconds)), read });
  }
  return out;
}

interface DayTotals {
  read: Set<number>;
  seconds: number;
}

function byDay(events: Closed[]): Map<string, DayTotals> {
  const days = new Map<string, DayTotals>();
  for (const e of events) {
    const d = days.get(e.date) ?? { read: new Set<number>(), seconds: 0 };
    d.seconds += e.seconds;
    if (e.read) d.read.add(e.storyId);
    days.set(e.date, d);
  }
  return days;
}

/** Visible story count per issue date (current version), for dates in [from, to]. */
function issueStories(ctx: Context, from: string, to: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of ctx.db.query(
    "SELECT i.date AS date, (SELECT COUNT(*) FROM stories s WHERE s.issue_date = i.date AND s.issue_version = i.version AND s.hidden = 0) AS n " +
      "FROM issues i WHERE i.date BETWEEN ? AND ?",
    [from, to],
  )) {
    out.set(r.date, Number(r.n));
  }
  return out;
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function readingDay(date: string, issues: Map<string, number>, days: Map<string, DayTotals>): ReadingDay {
  const t = days.get(date);
  return {
    date,
    issue: issues.has(date),
    stories: issues.get(date) ?? 0,
    read: t ? t.read.size : 0,
    minutes: t ? round1(t.seconds / 60) : 0,
  };
}

// ---- streak ----

/** Streak rules (CONTRACT.md): consecutive reading days ending today, or yesterday if nothing is read yet today. */
export function streakFrom(readingDays: Set<string>, today: string): Streak {
  let end = readingDays.has(today) ? today : addDays(today, -1);
  let current = 0;
  let since: string | null = null;
  for (let d = end; readingDays.has(d); d = addDays(d, -1)) {
    current++;
    since = d;
  }
  let longest = 0;
  let longestFrom: string | null = null;
  let longestTo: string | null = null;
  const sorted = [...readingDays].filter((d) => d <= today).sort();
  let runStart: string | null = null;
  let runLen = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev !== null && addDays(prev, 1) === d) runLen++;
    else {
      runStart = d;
      runLen = 1;
    }
    // ">=" so a tie goes to the most recent run.
    if (runLen >= longest) {
      longest = runLen;
      longestFrom = runStart;
      longestTo = d;
    }
    prev = d;
  }
  return { current, current_since: since, longest, longest_from: longestFrom, longest_to: longestTo };
}

export function streakDetail(ctx: Context, today: string): Streak {
  const days = new Set(closedEvents(ctx).filter((e) => e.read).map((e) => e.date));
  return streakFrom(days, today);
}

// ---- reading view ----

export function readingView(ctx: Context, today: string, days: number): ReadingView {
  const from = addDays(today, -(days - 1));
  const events = closedEvents(ctx, from, today);
  const perDay = byDay(events);
  const issues = issueStories(ctx, from, today);
  const list = datesBetween(from, today).map((d) => readingDay(d, issues, perDay));
  const totalRead = list.reduce((n, d) => n + d.read, 0);
  const totalMinutes = list.reduce((n, d) => n + d.minutes, 0);

  // Topics: stories shown in issues dated in the range, and stories read in the range.
  const shownStats = storyStats(ctx.db, ctx.config, today, { days }).filter((s) => s.currentVersion && s.shown);
  const readIds = [...new Set(events.filter((e) => e.read).map((e) => e.storyId))];
  const readTopics = new Map<string, number>();
  if (readIds.length) {
    for (const r of ctx.db.query(`SELECT topic FROM stories WHERE id IN (${readIds.map(() => "?").join(",")})`, readIds)) {
      readTopics.set(r.topic, (readTopics.get(r.topic) ?? 0) + 1);
    }
  }
  const topics = ctx.config.topics.map((t) => ({
    name: t.name,
    read: readTopics.get(t.name) ?? 0,
    shown: shownStats.filter((s) => s.topic === t.name).length,
  }));

  return {
    from,
    to: today,
    days: list,
    streak: streakDetail(ctx, today),
    reading_days: list.filter((d) => d.read > 0).length,
    total_read: totalRead,
    avg_read_per_day: round1(totalRead / days),
    avg_minutes_per_day: round1(totalMinutes / days),
    topics,
  };
}

// ---- calendar ----

export function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

export function calendarView(ctx: Context, today: string, month: string): CalendarView {
  const dates = monthDates(month);
  const first = dates[0];
  const last = dates.at(-1)!;
  const perDay = byDay(closedEvents(ctx, first, last));
  const issues = issueStories(ctx, first, last);
  // Which stories have ever been read, for "all_read".
  const everRead = new Set(closedEvents(ctx).filter((e) => e.read).map((e) => e.storyId));
  const days = dates.map((date) => {
    if (date > today) return { date, issue: false, stories: 0, read: 0, minutes: 0, all_read: false };
    const day = readingDay(date, issues, perDay);
    let allRead = false;
    if (day.issue && day.stories > 0) {
      const issue = ctx.db.getIssue(date)!;
      const visible = ctx.db.storiesFor(date, Number(issue.version)).filter((s) => !s.hidden);
      allRead = visible.every((s) => everRead.has(Number(s.id)));
    }
    return { ...day, all_read: allRead };
  });
  return {
    month,
    days,
    total_read: days.reduce((n, d) => n + d.read, 0),
    reading_days: days.filter((d) => d.read > 0).length,
    all_read_days: days.filter((d) => d.all_read).length,
    elapsed_days: dates.filter((d) => d <= today).length,
  };
}

// ---- run cost ----

export function runCost(ctx: Context, run: Row): RunCost {
  const calls = ctx.db.query("SELECT * FROM llm_calls WHERE run_id = ? ORDER BY id", [Number(run.id)]);
  const stages: StageCost[] = [];
  for (const stage of ["select", "rewrite", "check", "add"] as const) {
    const these = calls.filter((c) => c.stage === stage);
    if (these.length) stages.push({ stage, calls: these.length, cost_usd: round6(these.reduce((n, c) => n + Number(c.cost_usd), 0)) });
  }
  const started = Date.parse(run.started_at);
  const finished = run.finished_at ? Date.parse(run.finished_at) : NaN;
  return {
    run_id: Number(run.id),
    date: run.issue_date,
    started_at: run.started_at,
    seconds: Number.isFinite(finished) && Number.isFinite(started) ? Math.max(0, Math.round((finished - started) / 1000)) : null,
    status: run.status,
    calls: calls.length,
    cost_usd: round6(calls.reduce((n, c) => n + Number(c.cost_usd), 0)),
    input_tokens: calls.reduce((n, c) => n + Number(c.input_tokens), 0),
    output_tokens: calls.reduce((n, c) => n + Number(c.output_tokens), 0),
    sent_back: calls.filter((c) => c.outcome === "sent_back").length,
    refused: calls.filter((c) => c.stop_reason === "refusal").length,
    models: [...new Set(calls.map((c) => String(c.model)))],
    stages,
  };
}

export function lastRunCost(ctx: Context): RunCost | null {
  const run = ctx.db.queryOne("SELECT * FROM runs ORDER BY id DESC LIMIT 1");
  return run ? runCost(ctx, run) : null;
}

// ---- AI view ----

/** Average tokens per normal run over the last 14 days, for writer (select + rewrite) and checker. */
function averageTokens(ctx: Context, today: string) {
  const since = addDays(today, -13);
  const runs = ctx.db
    .query("SELECT id, started_at FROM runs WHERE status = 'created' ORDER BY id DESC LIMIT 200")
    .filter((r) => londonDate(new Date(r.started_at)) >= since);
  const writer = { in: 0, out: 0, n: 0 };
  const checker = { in: 0, out: 0, n: 0 };
  for (const run of runs) {
    const calls = ctx.db.query("SELECT stage, input_tokens, output_tokens FROM llm_calls WHERE run_id = ?", [Number(run.id)]);
    const w = calls.filter((c) => c.stage === "select" || c.stage === "rewrite");
    const c = calls.filter((x) => x.stage === "check");
    if (w.length) {
      writer.n++;
      writer.in += w.reduce((n, x) => n + Number(x.input_tokens), 0);
      writer.out += w.reduce((n, x) => n + Number(x.output_tokens), 0);
    }
    if (c.length) {
      checker.n++;
      checker.in += c.reduce((n, x) => n + Number(x.input_tokens), 0);
      checker.out += c.reduce((n, x) => n + Number(x.output_tokens), 0);
    }
  }
  return { writer, checker };
}

/** Models of every configured provider, with estimates from the last 14 days' average tokens. */
function modelOptions(ctx: Context, today: string): ModelOption[] {
  const avg = averageTokens(ctx, today);
  const est = (t: { in: number; out: number; n: number }, pin: number, pout: number) =>
    t.n ? round2(((t.in / t.n) * pin + (t.out / t.n) * pout) / 1e6) : null;
  return catalog(ctx.settings, ctx.config, injected(ctx)).map((m) => ({
    id: m.id,
    provider: m.provider,
    name: m.name,
    note: m.note,
    input_per_mtok: m.input_per_mtok,
    output_per_mtok: m.output_per_mtok,
    est_day_writer_usd: est(avg.writer, m.input_per_mtok, m.output_per_mtok),
    est_day_checker_usd: est(avg.checker, m.input_per_mtok, m.output_per_mtok),
  }));
}

function providerList(ctx: Context): AiView["providers"] {
  const on = configured(ctx.settings, injected(ctx));
  return (["anthropic", "openrouter"] as ProviderId[]).map((id) => ({
    id,
    name: PROVIDER_NAMES[id],
    configured: on[id],
    last_used: (ctx.db.queryOne("SELECT MAX(at) AS t FROM llm_calls WHERE provider = ?", [id])?.t as string | null) ?? null,
  }));
}

const londonClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: LONDON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "YYYY-MM-DD HH:MM" in Europe/London. */
export function londonDateTime(d: Date): string {
  const p = Object.fromEntries(londonClock.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

export function aiView(ctx: Context, now: Date): AiView {
  const today = londonDate(now);
  const month = today.slice(0, 7);
  const settings = effectiveAiSettings(ctx.settings, ctx.db, injected(ctx));
  const calls = callsInMonth(ctx.db, month);
  const soFar = monthDates(month).filter((d) => d <= today);
  const costByDay = new Map<string, number>();
  for (const c of calls) {
    const d = londonDate(new Date(c.at));
    costByDay.set(d, (costByDay.get(d) ?? 0) + Number(c.cost_usd));
  }
  const cost = calls.reduce((n, c) => n + Number(c.cost_usd), 0);
  const daysInMonth = monthDates(month).length;

  // Quality this month.
  const issues = ctx.db.query("SELECT date FROM issues WHERE date >= ? AND date <= ?", [`${month}-01`, today]);
  let onTime = 0;
  for (const i of issues) {
    const first = ctx.db.queryOne("SELECT MIN(created_at) AS t FROM stories WHERE issue_date = ?", [i.date])?.t;
    if (first && londonDateTime(new Date(first)) < `${i.date} 07:00`) onTime++;
  }
  const runs = ctx.db
    .query("SELECT started_at, finished_at FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 500")
    .filter((r) => londonDate(new Date(r.started_at)).startsWith(month));
  const durations = runs.map((r) => (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000).filter((s) => Number.isFinite(s) && s >= 0);
  const lastCall = ctx.db.queryOne("SELECT provider FROM llm_calls ORDER BY id DESC LIMIT 1");

  return {
    settings,
    models: modelOptions(ctx, today),
    providers: providerList(ctx),
    last_run: lastRunCost(ctx),
    month: {
      month,
      cost_usd: round6(cost),
      limit_usd: settings.monthly_limit_usd,
      projected_usd: round2(soFar.length ? (cost / soFar.length) * daysInMonth : 0),
      days: soFar.map((date) => ({ date, cost_usd: round6(costByDay.get(date) ?? 0) })),
    },
    quality: {
      sent_back: calls.filter((c) => c.outcome === "sent_back").length,
      refused: calls.filter((c) => c.stop_reason === "refusal").length,
      on_time: onTime,
      issues: issues.length,
      avg_seconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    },
    provider_last_used: lastCall ? String(lastCall.provider) : null,
  };
}
