/**
 * Resetting reading history (CONTRACT.md "Reading since").
 *
 * Reading is recorded twice: as events on the server (the dashboard, topic weighting) and in the
 * Kindle's own reading log (My week, its streak and words). A reset deletes the server's events
 * from before a date and records that date as `reading_since`. Every issue response carries it,
 * and the plugin drops older entries from its log at its next sync, so both sides agree.
 * Events that arrive later but were read before the date (a Kindle that was offline) are accepted
 * and dropped, so they can't bring old reading back.
 */

import type { Database } from "./db.js";
import { isIsoDate, LONDON } from "./timeutil.js";

const KEY = "reading_since";

export function readingSince(db: Database): string | null {
  const v = db.queryOne("SELECT value FROM settings WHERE key = ?", [KEY])?.value;
  return typeof v === "string" && isIsoDate(v) ? v : null;
}

/** Seconds since the epoch at London midnight starting `date` (YYYY-MM-DD). */
export function londonMidnight(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  // London is UTC+0 or UTC+1: try both offsets and keep the one that is midnight in London.
  for (const offset of [0, 1]) {
    const t = Date.UTC(y, m - 1, d, -offset) / 1000;
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t * 1000));
    if (hm === "00:00") return t;
  }
  throw new Error(`no London midnight for ${date}`);
}

export interface ResetResult {
  since: string;
  eventsDeleted: number;
}

/** Deletes reading events from before `since` and records it, so the Kindle drops them too. */
export function resetReading(db: Database, since: string, dryRun = false): ResetResult {
  if (!isIsoDate(since)) throw new Error(`since must be YYYY-MM-DD, not ${JSON.stringify(since)}`);
  const cutoff = londonMidnight(since);
  const n = Number(db.queryOne("SELECT COUNT(*) AS n FROM events WHERE ts < ?", [cutoff])?.n ?? 0);
  if (!dryRun) {
    db.transaction(() => {
      db.run("DELETE FROM events WHERE ts < ?", [cutoff]);
      db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [KEY, since]);
    });
  }
  return { since, eventsDeleted: n };
}

/** True for an event read before the reset date, which intake accepts but does not store. */
export function beforeReset(db: Database, ts: number | null): boolean {
  const since = readingSince(db);
  return since !== null && ts !== null && ts < londonMidnight(since);
}
