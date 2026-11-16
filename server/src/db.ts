/** SQLite storage (node:sqlite). Schema migrations run on start, tracked with PRAGMA user_version. */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Each entry is applied once, in order. Never edit an applied migration; append a new one.
export const MIGRATIONS: string[] = [
  // 1: DESIGN 4.6 plus stories.hidden, stories.source_title (for 14-day de-duplication by
  // the source's headline) and a small runs log shown on the dashboard.
  `
    CREATE TABLE issues (
        date        TEXT PRIMARY KEY,
        version     INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        fallback    INTEGER NOT NULL DEFAULT 0,
        story_count INTEGER NOT NULL
    );
    CREATE TABLE stories (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_date     TEXT NOT NULL,
        issue_version  INTEGER NOT NULL,
        position       INTEGER NOT NULL,
        topic          TEXT NOT NULL,
        title          TEXT NOT NULL,
        teaser         TEXT NOT NULL,
        body_html      TEXT NOT NULL,
        word_to_know   TEXT,
        think_about_it TEXT,
        source_name    TEXT NOT NULL,
        source_url     TEXT NOT NULL,
        source_title   TEXT,
        word_count     INTEGER NOT NULL,
        reused_from    INTEGER REFERENCES stories(id),
        hidden         INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL,
        UNIQUE (issue_date, issue_version, position)
    );
    CREATE INDEX stories_issue ON stories (issue_date, issue_version);
    CREATE TABLE events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id       TEXT NOT NULL,
        client_event_id TEXT NOT NULL,
        story_id        INTEGER REFERENCES stories(id),
        type            TEXT NOT NULL,
        ts              INTEGER,
        received_at     TEXT NOT NULL,
        payload_json    TEXT NOT NULL DEFAULT '{}',
        UNIQUE (device_id, client_event_id)
    );
    CREATE INDEX events_story ON events (story_id);
    CREATE INDEX events_type ON events (type);
    CREATE TABLE topic_overrides (
        topic TEXT PRIMARY KEY,
        mode  TEXT NOT NULL CHECK (mode IN ('pin', 'block'))
    );
    CREATE TABLE runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_date  TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT ''
    );
  `,
  // 2: parent-added articles (CONTRACT.md "Parent-added articles"): the 30-day feed archive,
  // requests for tomorrow's issue, and a marker on stories a parent added.
  `
    ALTER TABLE stories ADD COLUMN added_by TEXT;
    CREATE TABLE articles (
        url          TEXT PRIMARY KEY,
        source_name  TEXT NOT NULL,
        title        TEXT NOT NULL,
        summary      TEXT NOT NULL DEFAULT '',
        published_at TEXT,
        fetched_at   TEXT NOT NULL
    );
    CREATE INDEX articles_published ON articles (published_at);
    CREATE INDEX articles_fetched ON articles (fetched_at);
    CREATE TABLE add_requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        url          TEXT NOT NULL,
        source_name  TEXT NOT NULL,
        title        TEXT NOT NULL,
        summary      TEXT NOT NULL DEFAULT '',
        topic        TEXT,
        for_date     TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'added', 'failed', 'cancelled')),
        used_date    TEXT,
        story_id     INTEGER REFERENCES stories(id),
        detail       TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX add_requests_status ON add_requests (status, for_date);
  `,
  // 3: dashboard v2 (CONTRACT.md "Dashboard v2"): every LLM call with its tokens and cost, tied to a
  // generation run or a parent-add job, and the AI settings a parent can change.
  `
    CREATE TABLE llm_calls (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id        INTEGER REFERENCES runs(id),
        job_id        TEXT,
        at            TEXT NOT NULL,
        stage         TEXT NOT NULL CHECK (stage IN ('select', 'rewrite', 'check', 'add')),
        provider      TEXT NOT NULL,
        model         TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        stop_reason   TEXT,
        cost_usd      REAL NOT NULL DEFAULT 0,
        priced        INTEGER NOT NULL DEFAULT 1,
        outcome       TEXT
    );
    CREATE INDEX llm_calls_run ON llm_calls (run_id);
    CREATE INDEX llm_calls_at ON llm_calls (at);
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
  `,
  // 4: story photos for the iPad reader (CONTRACT.md "Story photos"): the source article's main
  // image, stored beside the story file as <position>.<image_ext>. NULL image_ext means no photo.
  `
    ALTER TABLE stories ADD COLUMN image_ext TEXT;
    ALTER TABLE stories ADD COLUMN image_alt TEXT;
    ALTER TABLE stories ADD COLUMN image_url TEXT;
  `,
];

// Full-text search over the archive, when this SQLite build has FTS5. Not a numbered migration
// because it depends on the build; LIKE is the fallback.
const FTS_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, summary, content='articles', content_rowid='rowid');
  CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
  END;
  CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, title, summary) VALUES ('delete', old.rowid, old.title, old.summary);
  END;
  CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, title, summary) VALUES ('delete', old.rowid, old.title, old.summary);
    INSERT INTO articles_fts(rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
  END;
`;

export type Row = Record<string, any>;
type Param = string | number | bigint | null | Uint8Array;

export function utcnowIso(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function loadsJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const plain = (r: any): Row => (r ? { ...r } : r);

export class Database {
  readonly file: string;
  private conn: DatabaseSync | null = null;
  ftsEnabled = false;

  constructor(file: string) {
    this.file = file;
  }

  get db(): DatabaseSync {
    if (!this.conn) throw new Error("database not initialised");
    return this.conn;
  }

  init(): void {
    if (this.file !== ":memory:") mkdirSync(path.dirname(this.file), { recursive: true });
    this.conn?.close();
    this.conn =new DatabaseSync(this.file, { timeout: 30000 } as any);
    this.conn.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    const current = Number(this.queryOne("PRAGMA user_version")?.user_version ?? 0);
    MIGRATIONS.forEach((script, i) => {
      const index = i + 1;
      if (index <= current) return;
      this.conn!.exec(`BEGIN; ${script}; PRAGMA user_version = ${index}; COMMIT;`);
    });
    try {
      this.conn.exec(FTS_SQL);
      const counts = this.queryOne(
        "SELECT (SELECT COUNT(*) FROM articles) AS a, (SELECT COUNT(*) FROM articles_fts) AS f",
      );
      if (counts && counts.a !== counts.f) this.conn.exec("INSERT INTO articles_fts(articles_fts) VALUES ('rebuild')");
      this.ftsEnabled = true;
    } catch {
      this.ftsEnabled = false;
    }
  }

  close(): void {
    this.conn?.close();
    this.conn = null;
  }

  query(sql: string, params: Param[] = []): Row[] {
    return this.db.prepare(sql).all(...params).map(plain);
  }

  queryOne(sql: string, params: Param[] = []): Row | undefined {
    return plain(this.db.prepare(sql).get(...params));
  }

  run(sql: string, params: Param[] = []): { changes: number; lastId: number } {
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  /** Synchronous transaction. Never await inside `fn`. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- issues and stories ----

  getIssue(date: string): Row | undefined {
    return this.queryOne("SELECT * FROM issues WHERE date = ?", [date]);
  }

  storiesFor(date: string, version: number): Row[] {
    return this.query("SELECT * FROM stories WHERE issue_date = ? AND issue_version = ? ORDER BY position", [date, version]);
  }

  getStory(id: number): Row | undefined {
    return this.queryOne("SELECT * FROM stories WHERE id = ?", [id]);
  }

  setHidden(id: number, hidden: boolean): boolean {
    return this.run("UPDATE stories SET hidden = ? WHERE id = ?", [hidden ? 1 : 0, id]).changes > 0;
  }

  // ---- topic overrides ----

  topicOverrides(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.query("SELECT topic, mode FROM topic_overrides")) out[r.topic] = r.mode;
    return out;
  }

  setTopicOverride(topic: string, mode: string | null): void {
    if (mode === "pin" || mode === "block") {
      this.run(
        "INSERT INTO topic_overrides (topic, mode) VALUES (?, ?) ON CONFLICT(topic) DO UPDATE SET mode = excluded.mode",
        [topic, mode],
      );
    } else {
      this.run("DELETE FROM topic_overrides WHERE topic = ?", [topic]);
    }
  }

  // ---- runs log ----

  /** `at` is for imports of past runs; normal runs start now. */
  startRun(date: string, at?: Date): number {
    return this.run("INSERT INTO runs (issue_date, started_at, status) VALUES (?, ?, 'running')", [date, utcnowIso(at)]).lastId;
  }

  finishRun(id: number, status: string, detail: string[], at?: Date): void {
    this.run("UPDATE runs SET finished_at = ?, status = ?, detail = ? WHERE id = ?", [utcnowIso(at), status, detail.join("\n"), id]);
  }
}
