/**
 * Reading settings for one child, set on the parent dashboard: how quickly a story can be read and
 * still count as read properly. A story read to the end in less than `min_reading` of its expected
 * reading time was skimmed or paged through: it is "read too fast" (docs/dashboard.md), it isn't
 * engaged, and it doesn't count toward opening Sport (docs/sports-page.md 2.7).
 *
 * Stored in the profile's `settings` table under "reading". Before this setting it lived in the Sport
 * settings ("sport"), so a value there is still used when none is stored here; config.yaml's
 * `min_reading` gives the starting value.
 */

import { loadsJson, type Database } from "./db.js";
import type { Config } from "./config.js";

import type { ReadingSettings } from "./dashboard/types.js";

export type { ReadingSettings };

const KEY = "reading";

export class ReadingSettingsError extends Error {}

const share = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null);

function stored(db: Database, key: string): Record<string, unknown> {
  const row = db.queryOne("SELECT value FROM settings WHERE key = ?", [key]);
  const v = loadsJson<Record<string, unknown>>(row?.value, {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** The settings in force: the dashboard's, else the old Sport setting, else the config's. */
export function readingSettings(db: Database, config: Config): ReadingSettings {
  return { min_reading: share(stored(db, KEY).min_reading) ?? share(stored(db, "sport").min_reading) ?? config.minReading };
}

/** Change them. Throws ReadingSettingsError with a sentence for the parent when a value won't do. */
export function updateReadingSettings(db: Database, config: Config, body: unknown): ReadingSettings {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ReadingSettingsError("Send the settings to change.");
  const b = body as Record<string, unknown>;
  const next = stored(db, KEY);
  if ("min_reading" in b) {
    const v = share(b.min_reading);
    if (v === null) throw new ReadingSettingsError("The reading time must be between 0 and 1.");
    next.min_reading = v;
  }
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [KEY, JSON.stringify(next)]);
  return readingSettings(db, config);
}
