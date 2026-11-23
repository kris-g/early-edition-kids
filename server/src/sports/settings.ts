/**
 * The Sport page's settings for one child, set on the parent dashboard (docs/sports-page.md 2.7 and
 * 5.4). Stored in the profile's `settings` table under "sport"; anything not set there comes from
 * config.yaml's `sports` block, as the AI settings come from the environment.
 */

import { loadsJson, type Database } from "../db.js";
import type { Config } from "../config.js";
import type { SportSettings } from "../dashboard/types.js";

export type { SportSettings };

const KEY = "sport";

export class SportSettingsError extends Error {}

function readStored(db: Database): Partial<SportSettings> {
  const row = db.queryOne("SELECT value FROM settings WHERE key = ?", [KEY]);
  const v = loadsJson<Partial<SportSettings>>(row?.value, {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

const share = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null);

/** The settings in force: the dashboard's, over the config's. */
export function sportSettings(db: Database, config: Config): SportSettings {
  const s = readStored(db);
  return {
    enabled: typeof s.enabled === "boolean" ? s.enabled : config.sports.enabled,
    read_first: share(s.read_first) ?? config.sports.readFirst,
    min_reading: share(s.min_reading) ?? config.sports.minReading,
  };
}

/** Change some of them. Throws SportSettingsError with a sentence for the parent when a value won't do. */
export function updateSportSettings(db: Database, config: Config, body: unknown): SportSettings {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new SportSettingsError("Send the settings to change.");
  const b = body as Record<string, unknown>;
  const next = readStored(db);
  if ("enabled" in b) {
    if (typeof b.enabled !== "boolean") throw new SportSettingsError("Sport is either on or off.");
    next.enabled = b.enabled;
  }
  for (const key of ["read_first", "min_reading"] as const) {
    if (!(key in b)) continue;
    const v = share(b[key]);
    if (v === null) throw new SportSettingsError(`${key === "read_first" ? "How much to read first" : "The reading time"} must be between 0 and 1.`);
    next[key] = v;
  }
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [KEY, JSON.stringify(next)]);
  return sportSettings(db, config);
}
