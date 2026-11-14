/**
 * Consistent copy of the live database: `tsx src/backup.ts /data/backup.db`.
 * Uses SQLite's VACUUM INTO, which is safe while the server is running.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = process.env.EARLY_EDITION_KIDS_DATA_DIR || "./data";
const source = path.join(dataDir, "early-edition-kids.db");
const target = process.argv[2] || path.join(dataDir, "backup.db");
if (existsSync(target)) {
  console.error(`${target} already exists; remove it or pick another path`);
  process.exit(1);
}
const db = new DatabaseSync(source, { readOnly: true });
db.prepare("VACUUM INTO ?").run(target);
db.close();
console.log(`backed up ${source} to ${target}`);
