/**
 * When the Kindle last synced: any request for today's paper or any events upload. Shown on the
 * dashboard's Today card, so a parent can tell whether the latest reading has arrived yet.
 * Catch-up fetches of older papers always follow one of these, so they are not recorded.
 */

import type { Database } from "./db.js";

const KEY = "kindle_seen_at";

export function markKindleSeen(db: Database, at: Date): void {
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
    KEY,
    at.toISOString(),
  ]);
}

export function kindleSeenAt(db: Database): string | null {
  const v = db.queryOne("SELECT value FROM settings WHERE key = ?", [KEY])?.value;
  return typeof v === "string" && v ? v : null;
}
