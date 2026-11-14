import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { Database } from "../src/db.js";
import { addDays } from "../src/timeutil.js";
import { effectiveWeight, engagementRate, minutesFor, storyStats, streak, topicStats } from "../src/weights.js";
import { TODAY, tmpDir } from "./helpers.js";

describe("weighting maths", () => {
  it("computes engagement rate and weight", () => {
    expect(engagementRate(0, 0)).toBe(0.5);
    expect(effectiveWeight(3, engagementRate(0, 0))).toBe(3); // no data: base weight
    expect(engagementRate(4, 4)).toBeCloseTo(5 / 6);
    expect(engagementRate(0, 4)).toBeCloseTo(1 / 6);
    // Bounded between 0.5x and 1.5x base.
    expect(effectiveWeight(2, 0)).toBe(1);
    expect(effectiveWeight(2, 1)).toBe(3);
    expect(effectiveWeight(3, engagementRate(10, 10))).toBeLessThan(4.5);
  });

  it("rounds minutes like the original server", () => {
    expect(minutesFor(30, 90)).toBe(1);
    expect(minutesFor(140, 90)).toBe(2);
    expect(minutesFor(160, 90)).toBe(2);
    expect(minutesFor(225, 90)).toBe(2); // 2.5 rounds half to even
  });
});

describe("reading signals", () => {
  let db: Database;
  const cfg = parseConfig({
    reading_wpm: 90,
    topics: [
      { name: "Football", base_weight: 3 },
      { name: "Science", base_weight: 3 },
      { name: "Space", base_weight: 2 },
    ],
  });

  beforeEach(() => {
    db = new Database(path.join(tmpDir(), "k.db"));
    db.init();
  });
  afterEach(() => db.close());

  function addIssue(day: string, topics: string[], words = 135): number[] {
    return db.transaction(() => {
      db.run("INSERT INTO issues (date, version, created_at, fallback, story_count) VALUES (?, 1, 'x', 0, ?)", [day, topics.length]);
      return topics.map(
        (t, i) =>
          db.run(
            "INSERT INTO stories (issue_date, issue_version, position, topic, title, teaser, body_html, source_name, source_url, word_count, created_at) " +
              "VALUES (?, 1, ?, ?, 't', 't', '', 's', ?, ?, 'x')",
            [day, i + 1, t, `https://e/${day}/${i + 1}`, words],
          ).lastId,
      );
    });
  }

  function ev(type: string, storyId: number | null = null, payload = "{}") {
    db.run(
      "INSERT INTO events (device_id, client_event_id, story_id, type, ts, received_at, payload_json) VALUES ('d', ?, ?, ?, 0, 'x', ?)",
      [randomUUID(), storyId, type, payload],
    );
  }

  function closed(sid: number, active: number, finished = true, pages = 2) {
    ev("story_opened", sid);
    ev("story_closed", sid, JSON.stringify({ active_seconds: active, pages_total: pages, max_page: finished ? pages : 1, finished }));
  }

  it("needs open, end and half the time to count as engaged", () => {
    const [a, b, c, d] = addIssue(TODAY, ["Football", "Football", "Science", "Space"]); // 135 words = 90s expected
    ev("list_shown", null, JSON.stringify({ date: TODAY, version: 1 }));
    closed(a, 50); // engaged: >= 45s
    closed(b, 30); // too fast
    closed(c, 80, false); // did not reach the end
    const stats = new Map(storyStats(db, cfg, TODAY).map((s) => [s.id, s]));
    expect(stats.get(a)!.engaged).toBe(true);
    expect(stats.get(b)!.engaged).toBe(false);
    expect(stats.get(c)!.engaged).toBe(false);
    expect(stats.get(d)!.shown).toBe(true);
    expect(stats.get(d)!.opened).toBe(false);
    expect(stats.get(a)!.expectedSeconds).toBeCloseTo(90);

    const topics = new Map(topicStats(cfg, {}, [...stats.values()]).map((t) => [t.name, t]));
    expect(topics.get("Football")!.shown).toBe(2);
    expect(topics.get("Football")!.engaged).toBe(1);
    expect(topics.get("Football")!.rate).toBeCloseTo(2 / 4);
    expect(topics.get("Football")!.weight).toBeCloseTo(3);
    expect(topics.get("Science")!.rate).toBeCloseTo(1 / 3);
    expect(topics.get("Science")!.weight).toBeCloseTo(3 * (0.5 + 1 / 3));
    expect(topics.get("Space")!.rate).toBeCloseTo(1 / 3);
    expect(topics.get("Football")!.openRate).toBe(1);
  });

  it("does not count days without list_shown", () => {
    addIssue(addDays(TODAY, -1), ["Football", "Science"]);
    const stats = storyStats(db, cfg, TODAY);
    expect(stats.some((s) => s.shown)).toBe(false);
    const football = topicStats(cfg, {}, stats).find((t) => t.name === "Football")!;
    expect(football.shown).toBe(0);
    expect(football.weight).toBe(3);
  });

  it("uses a 14-day window", () => {
    const old = addDays(TODAY, -14);
    addIssue(old, ["Football"]);
    ev("list_shown", null, JSON.stringify({ date: old, version: 1 }));
    expect(storyStats(db, cfg, TODAY)).toEqual([]);
  });

  it("lets pin and block override the maths", () => {
    const topics = new Map(topicStats(cfg, { Space: "pin", Football: "block" }, []).map((t) => [t.name, t]));
    expect(topics.get("Football")!.weight).toBe(0);
    expect(topics.get("Space")!.weight).toBeCloseTo(3); // raised to the top weight
    expect(topics.get("Space")!.mode).toBe("pin");
  });

  it("moves weights with data", () => {
    for (let back = 0; back < 5; back++) {
      const day = addDays(TODAY, -back);
      const [f] = addIssue(day, ["Football", "Science"]);
      ev("list_shown", null, JSON.stringify({ date: day, version: 1 }));
      closed(f, 100);
    }
    const topics = new Map(topicStats(cfg, {}, storyStats(db, cfg, TODAY)).map((t) => [t.name, t]));
    expect(topics.get("Football")!.weight).toBeGreaterThan(3);
    expect(topics.get("Science")!.weight).toBeLessThan(3);
  });

  it("counts the streak", () => {
    for (const back of [1, 2, 3, 5]) {
      const [sid] = addIssue(addDays(TODAY, -back), ["Football"]);
      closed(sid, 100);
    }
    expect(streak(storyStats(db, cfg, TODAY), TODAY)).toBe(3); // today not read yet: counts back from yesterday
    const [sid] = addIssue(TODAY, ["Science"]);
    closed(sid, 100);
    expect(streak(storyStats(db, cfg, TODAY), TODAY)).toBe(4);
  });
});
