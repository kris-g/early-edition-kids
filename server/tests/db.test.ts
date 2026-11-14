import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Database, MIGRATIONS } from "../src/db.js";
import { tmpDir } from "./helpers.js";

describe("database", () => {
  it("opens a database made by the original server (schema version 1) and migrates it", () => {
    const file = path.join(tmpDir(), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`BEGIN; ${MIGRATIONS[0]}; PRAGMA user_version = 1; COMMIT;`);
    old.exec(
      "INSERT INTO issues VALUES ('2026-11-13', 1, '2026-11-13T05:30:00+00:00', 0, 1);" +
        "INSERT INTO stories (issue_date, issue_version, position, topic, title, teaser, body_html, source_name, source_url, word_count, created_at) " +
        "VALUES ('2026-11-13', 1, 1, 'Space', 't', 't', '<p>x</p>', 's', 'https://e/1', 120, 'x');",
    );
    old.close();

    const db = new Database(file);
    db.init();
    expect(db.queryOne("PRAGMA user_version")!.user_version).toBe(MIGRATIONS.length);
    const story = db.getStory(1)!;
    expect(story.title).toBe("t");
    expect(story.added_by).toBeNull();
    expect(db.query("SELECT * FROM articles")).toEqual([]);
    db.init(); // idempotent
    expect(db.queryOne("PRAGMA user_version")!.user_version).toBe(MIGRATIONS.length);
    db.close();
  });
});
