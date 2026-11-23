/**
 * Time on the Sport page, for the dashboard (docs/sports-page.md 5.4). The readers send a
 * `sport_viewed` event each time a Sport page is left; it is kept apart from reading, so it never
 * counts toward read stories, reading days, the streak, minutes or topic weights.
 */

import { loadsJson } from "../db.js";
import type { Context } from "../pipeline.js";
import { addDays, londonDate } from "../timeutil.js";
import type { SportDay, SportPage, SportPageUse, SportUsageView } from "./types.js";

export const SPORT_VIEWED = "sport_viewed";
const PAGES = new Set<SportPage>(["matches", "table", "next", "match"]);
/** Matches the readers' rule: at most 300 seconds between interactions; more than a day is not believed. */
const MAX_SECONDS = 24 * 60 * 60;

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

/**
 * A `sport_viewed` payload in our own shape, or null when it isn't one: `page`, `match_id` (for a
 * match only), `matchday`, `active_seconds`, and `match`, the match's name as the server knows it now.
 */
export function sportViewedPayload(p: Record<string, unknown>, label: (id: string) => string | null): Record<string, unknown> | null {
  const page = p.page;
  if (typeof page !== "string" || !PAGES.has(page as SportPage)) return null;
  const seconds = int(p.active_seconds);
  if (seconds === null || seconds < 0 || seconds > MAX_SECONDS) return null;
  const rawId = p.match_id;
  const matchId = page === "match" && typeof rawId === "string" && /^[\w-]{1,40}$/.test(rawId) ? rawId : null;
  if (page === "match" && matchId === null) return null;
  const matchday = int(p.matchday);
  return {
    page,
    match_id: matchId,
    matchday: matchday !== null && matchday > 0 && matchday < 100 ? matchday : null,
    active_seconds: seconds,
    match: matchId ? label(matchId) : null,
  };
}

interface Viewed {
  date: string;
  page: SportPage;
  match_id: string | null;
  match: string | null;
  seconds: number;
}

/** Every Sport view between two London dates, dated by the device's time (the server's, if missing), as reading is. */
function viewed(ctx: Context, from: string, to: string): Viewed[] {
  const out: Viewed[] = [];
  for (const e of ctx.db.query("SELECT ts, received_at, payload_json FROM events WHERE type = ?", [SPORT_VIEWED])) {
    const ts = Number(e.ts);
    const at = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(e.received_at);
    if (Number.isNaN(at.getTime())) continue;
    const date = londonDate(at);
    if (date < from || date > to) continue;
    const p = loadsJson<Record<string, any>>(e.payload_json, {}) ?? {};
    if (!PAGES.has(p.page)) continue;
    out.push({
      date,
      page: p.page,
      match_id: typeof p.match_id === "string" ? p.match_id : null,
      match: typeof p.match === "string" ? p.match : null,
      seconds: Math.max(0, int(p.active_seconds) ?? 0),
    });
  }
  return out;
}

/** Totals per page, and per match for match pages, most time first. */
function byPage(views: Viewed[]): SportPageUse[] {
  const by = new Map<string, SportPageUse>();
  for (const v of views) {
    const key = v.page === "match" ? `match:${v.match_id}` : v.page;
    const u = by.get(key) ?? { page: v.page, match_id: v.match_id, match: v.match, views: 0, seconds: 0 };
    u.views += 1;
    u.seconds += v.seconds;
    u.match ??= v.match;
    by.set(key, u);
  }
  return [...by.values()].sort((a, b) => b.seconds - a.seconds || b.views - a.views);
}

const total = (views: Viewed[]) => ({ views: views.length, seconds: views.reduce((n, v) => n + v.seconds, 0) });

/** One day's Sport views, or null when there were none. */
export function sportDay(ctx: Context, date: string): SportDay | null {
  const views = viewed(ctx, date, date);
  return views.length ? { date, ...total(views), pages: byPage(views) } : null;
}

/** The last `days` days ending today, every day listed. */
export function sportUsageView(ctx: Context, today: string, days: number): SportUsageView {
  const from = addDays(today, -(days - 1));
  const views = viewed(ctx, from, today);
  const perDay: SportDay[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const that = views.filter((v) => v.date === d);
    perDay.push({ date: d, ...total(that), pages: byPage(that) });
  }
  return { from, to: today, days: perDay, ...total(views), pages: byPage(views) };
}
