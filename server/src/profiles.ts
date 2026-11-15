/**
 * Where each profile keeps its data (CONTRACT.md "Profiles"), and running generation for all of them.
 *
 * Each profile has its own database and issues folder. The root location ($DATA/early-edition-kids.db
 * and $DATA/issues/, where a single-child setup has always kept them) belongs to exactly one profile
 * id, recorded in $DATA/profiles.json the first time the config has a `profiles:` list. Every other
 * profile lives under $DATA/profiles/<id>/. Because data is found by id, never by position, adding,
 * removing or reordering profiles cannot hand one child's data to another.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConfigError, DEFAULT_PROFILE, PROFILE_ID, loadProfiles, type Config, type Settings } from "./config.js";
import { generate, type Context, type GenerateResult } from "./pipeline.js";

export const MARKER_FILE = "profiles.json";

export interface ProfileLayout {
  /** Data directory per profile id (the root data dir for the owner). */
  dirs: Map<string, string>;
  /** The profile that owns the root location, or null when its owner is no longer configured. */
  root: string | null;
  /** A warning to log when the root data is left unused. */
  warning: string | null;
}

export const profileDir = (dataDir: string, id: string) => path.join(dataDir, "profiles", id);

function readOwner(dataDir: string): string | null {
  const file = path.join(dataDir, MARKER_FILE);
  if (!existsSync(file)) return null;
  let owner: unknown;
  try {
    owner = JSON.parse(readFileSync(file, "utf8"))?.root;
  } catch {
    owner = undefined;
  }
  if (typeof owner !== "string" || !PROFILE_ID.test(owner)) {
    throw new ConfigError(`${file} is not readable; it should look like {"root": "older"}. Fix it rather than deleting it.`);
  }
  return owner;
}

/**
 * Decide each profile's data directory. `explicit` is whether the config has a `profiles:` list;
 * the marker is written only then, so a single-child setup's data folder is never touched.
 */
export function resolveProfileLayout(dataDir: string, ids: string[], explicit: boolean, write = true): ProfileLayout {
  let owner = readOwner(dataDir);
  if (owner === null) {
    owner = explicit ? ids[0] : DEFAULT_PROFILE;
    if (explicit && write) {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(path.join(dataDir, MARKER_FILE), JSON.stringify({ root: owner }, null, 2) + "\n");
    }
  }
  const root = ids.includes(owner) ? owner : null;
  const dirs = new Map(ids.map((id) => [id, id === root ? dataDir : profileDir(dataDir, id)]));
  const warning =
    root === null
      ? `profiles: the data in ${dataDir} (early-edition-kids.db and issues/) belongs to profile '${owner}', ` +
        `which is not in the config, so it is left unused. Add a profile with id '${owner}' to use it again.`
      : null;
  return { dirs, root, warning };
}

/**
 * For the maintenance scripts: `--profile <id>` (default: the profile that owns the root data) to
 * settings whose dataDir is that profile's, and its merged config.
 */
export function profileFromArgs(settings: Settings, argv: string[]): { id: string; settings: Settings; config: Config } {
  const i = argv.indexOf("--profile");
  const wanted = i >= 0 ? argv[i + 1] : undefined;
  if (i >= 0 && (!wanted || wanted.startsWith("--"))) throw new ConfigError("--profile needs an id");
  const parsed = loadProfiles(settings.configPath);
  const ids = parsed.profiles.map((p) => p.id);
  const layout = resolveProfileLayout(settings.dataDir, ids, parsed.explicit);
  const id = wanted ?? layout.root;
  if (id === null) throw new ConfigError(`${layout.warning} Pass --profile <id> (one of ${ids.join(", ")}).`);
  const p = parsed.profiles.find((x) => x.id === id);
  if (!p) throw new ConfigError(`no profile '${id}' in ${settings.configPath} (profiles: ${ids.join(", ")})`);
  return { id, settings: { ...settings, dataDir: layout.dirs.get(id)! }, config: p.config };
}

export interface Profile {
  id: string;
  title: string;
  /** True for the profile that owns the root data and is also served at / (Kindle) and /api/dashboard (dashboard). */
  root: boolean;
  ctx: Context;
}

/** Generate `date` for each profile in turn (never two at once); the results keyed by id. */
export async function generateAll(profiles: Profile[], date: string, now: Date, force = false): Promise<Map<string, GenerateResult>> {
  const results = new Map<string, GenerateResult>();
  for (const p of profiles) {
    try {
      results.set(p.id, await generate(p.ctx, date, now, force));
    } catch (err) {
      console.error(`generation for profile ${p.id} threw`, err);
      results.set(p.id, { date, version: null, fallback: false, story_count: 0, status: "failed", detail: [`pipeline error: ${String(err)}`] });
    }
  }
  return results;
}
