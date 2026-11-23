/**
 * Sport opens after reading (docs/sports-page.md 2.7): at least a set share of today's stories, each
 * read to the end and not too fast. A story read faster than its share of the expected reading time
 * doesn't count: it was skimmed or paged through.
 *
 * The readers decide on the device, so it works offline: the issue payload carries the rule
 * (`unlockRule`). The server works out the same thing from the events it has (`unlockStatus`), for the
 * Sport page's payload (so reading on one device opens Sport on another) and for the dashboard.
 */

import type { Row } from "../db.js";
import { loadsJson } from "../db.js";
import type { Context } from "../pipeline.js";
import { expectedSeconds } from "../weights.js";
import type { SportSettings, UnlockStatus, UnlockStory } from "../dashboard/types.js";

/** What a reader needs to decide for itself: how many stories, and each story's least reading time. */
export interface UnlockRule {
  needed: number;
  /** Story id to the fewest active seconds that count. */
  min_seconds: Record<string, number>;
}

export type { UnlockStatus, UnlockStory };

/** The stories that count toward opening Sport: the paper's current version, without hidden ones. */
function paperStories(ctx: Context, date: string): Row[] {
  const issue = ctx.db.getIssue(date);
  if (!issue) return [];
  return ctx.db.storiesFor(date, Number(issue.version)).filter((r) => !r.hidden);
}

/** The least active time that counts: `min_reading` of its expected reading time, in whole seconds. */
const minSeconds = (r: Row, ctx: Context, s: SportSettings) =>
  Math.ceil(expectedSeconds(Number(r.word_count), ctx.config.readingWpm) * s.min_reading);

/** Half of six is three; any share above nothing needs at least one story. */
const neededOf = (total: number, s: SportSettings) => Math.min(total, Math.max(1, Math.ceil(total * s.read_first - 1e-9)));

/** The rule for a paper, or null when there is no lock: Sport is off, the lock is off, or the paper has no stories. */
export function unlockRule(ctx: Context, date: string, s: SportSettings): UnlockRule | null {
  if (!s.enabled || s.read_first <= 0) return null;
  const rows = paperStories(ctx, date);
  if (!rows.length) return null;
  return {
    needed: neededOf(rows.length, s),
    min_seconds: Object.fromEntries(rows.map((r) => [String(r.id), minSeconds(r, ctx, s)])),
  };
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : 0);

/**
 * How far the reading on a paper has got toward opening Sport, from every device's events. Several
 * sittings add up: a story's active time is the sum of its closes, and it is finished once any close
 * reached the last page. Null when there is no lock.
 */
export function unlockStatus(ctx: Context, date: string, s: SportSettings): UnlockStatus | null {
  const rule = unlockRule(ctx, date, s);
  if (!rule) return null;
  const rows = paperStories(ctx, date);
  const ids = rows.map((r) => Number(r.id));
  const events = ctx.db
    .query(
      `SELECT story_id, ts, received_at, payload_json FROM events WHERE type = 'story_closed' AND story_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    )
    .map((e) => {
      const p = loadsJson<Record<string, any>>(e.payload_json, {}) ?? {};
      const ts = int(e.ts);
      const at = ts > 0 ? ts * 1000 : Date.parse(e.received_at);
      const total = int(p.pages_total);
      return {
        id: Number(e.story_id),
        at: Number.isFinite(at) ? at : 0,
        seconds: Math.max(0, int(p.active_seconds)),
        finished: p.finished === true || (total > 0 && int(p.max_page) >= total),
      };
    })
    .sort((a, b) => a.at - b.at);

  // Replay in order, so the moment Sport opened is known.
  const seconds = new Map<number, number>();
  const finished = new Set<number>();
  const counting = new Set<number>();
  let unlockedAt: number | null = null;
  for (const e of events) {
    seconds.set(e.id, (seconds.get(e.id) ?? 0) + e.seconds);
    if (e.finished) finished.add(e.id);
    if (finished.has(e.id) && seconds.get(e.id)! >= rule.min_seconds[String(e.id)]) counting.add(e.id);
    if (unlockedAt === null && counting.size >= rule.needed) unlockedAt = e.at;
  }
  const stories: UnlockStory[] = rows.map((r) => {
    const id = Number(r.id);
    const active = seconds.get(id) ?? 0;
    const min = rule.min_seconds[String(id)];
    const done = finished.has(id);
    return { id, title: r.title, finished: done, active_seconds: active, min_seconds: min, counts: done && active >= min, rushed: done && active < min };
  });
  const counted = stories.filter((x) => x.counts).length;
  return {
    needed: rule.needed,
    total: rows.length,
    counted,
    unlocked: counted >= rule.needed,
    unlocked_at: unlockedAt === null ? null : new Date(unlockedAt).toISOString(),
    stories,
  };
}
