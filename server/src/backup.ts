/**
 * Consistent copies of the live databases: `tsx src/backup.ts /data/backup.db`.
 * Uses SQLite's VACUUM INTO, which is safe while the server is running.
 *
 * The root database ($DATA/early-edition-kids.db) is copied to the path given. Each extra profile's
 * database ($DATA/profiles/<id>/early-edition-kids.db, CONTRACT.md "Profiles") is copied beside it
 * with the id before the extension: /data/backup.younger.db. It works from the data directory alone,
 * so it needs no config and also copies the data of a profile no longer in the config.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const DB_FILE = "early-edition-kids.db";

export function backupTargets(dataDir: string, target: string): Array<{ source: string; target: string }> {
  const out: Array<{ source: string; target: string }> = [];
  const root = path.join(dataDir, DB_FILE);
  if (existsSync(root)) out.push({ source: root, target });
  const profilesDir = path.join(dataDir, "profiles");
  const ext = path.extname(target);
  const stem = ext ? target.slice(0, -ext.length) : target;
  if (existsSync(profilesDir)) {
    for (const id of readdirSync(profilesDir).sort()) {
      const source = path.join(profilesDir, id, DB_FILE);
      if (existsSync(source)) out.push({ source, target: `${stem}.${id}${ext || ".db"}` });
    }
  }
  return out;
}

export function main(argv: string[], env: NodeJS.ProcessEnv = process.env): number {
  const dataDir = env.EARLY_EDITION_KIDS_DATA_DIR || "./data";
  const target = argv[0] || path.join(dataDir, "backup.db");
  const jobs = backupTargets(dataDir, target);
  if (!jobs.length) {
    console.error(`no database found in ${dataDir}`);
    return 1;
  }
  const taken = jobs.filter((j) => existsSync(j.target));
  if (taken.length) {
    console.error(`${taken.map((j) => j.target).join(", ")} already exist${taken.length === 1 ? "s" : ""}; remove or pick another path`);
    return 1;
  }
  for (const j of jobs) {
    const db = new DatabaseSync(j.source, { readOnly: true });
    try {
      db.prepare("VACUUM INTO ?").run(j.target);
    } finally {
      db.close();
    }
    console.log(`backed up ${j.source} to ${j.target}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
