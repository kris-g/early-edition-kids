/**
 * Reset reading history: delete reading events from before a date, and have the Kindle drop its
 * own reading-log entries from before it at its next sync (CONTRACT.md "Reading since").
 *
 *   tsx scripts/reset-reading.ts --since 2026-11-14 [--dry-run] [--profile younger]
 *
 * Use it after testing on the real Kindle, so test reads don't count in the dashboard, My week,
 * the streak or tomorrow's topic weighting. Papers, stories and settings are not touched. With several
 * profiles, --profile picks the child (default: the profile that owns the root data).
 */

import { pathToFileURL } from "node:url";
import { dbPath, settingsFromEnv } from "../src/config.js";
import { profileFromArgs } from "../src/profiles.js";
import { Database } from "../src/db.js";
import { readingSince, resetReading } from "../src/readingreset.js";

export function main(argv: string[]): number {
  const i = argv.indexOf("--since");
  const since = i >= 0 ? argv[i + 1] : undefined;
  const dryRun = argv.includes("--dry-run");
  if (!since) {
    console.error("usage: tsx scripts/reset-reading.ts --since YYYY-MM-DD [--dry-run] [--profile <id>]");
    return 2;
  }
  let profile;
  try {
    profile = profileFromArgs(settingsFromEnv(), argv);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  const db = new Database(dbPath(profile.settings));
  db.init();
  try {
    const before = readingSince(db);
    const r = resetReading(db, since, dryRun);
    console.log(
      `${profile.id === "default" ? "" : `${profile.id}: `}${dryRun ? "would delete" : "deleted"} ${r.eventsDeleted} reading event${r.eventsDeleted === 1 ? "" : "s"} from before ${r.since} (London time)` +
        `${before ? `; reading_since was ${before}` : ""}. ${dryRun ? "Nothing changed." : "The Kindle drops its older entries at its next sync."}`,
    );
    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  } finally {
    db.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
