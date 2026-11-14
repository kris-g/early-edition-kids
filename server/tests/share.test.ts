import { afterEach, describe, expect, it } from "vitest";
import { milestoneFor, nextMilestone, shareView } from "../src/dashboard/share.js";
import { generate } from "../src/pipeline.js";
import { NOW, TODAY, makeApp, makeCtx, type TestApp } from "./helpers.js";

let t: TestApp | undefined;
let ctx: ReturnType<typeof makeCtx> | undefined;
afterEach(() => {
  t?.cleanup();
  ctx?.cleanup();
  t = undefined;
  ctx = undefined;
});

function closed(c: { db: any }, storyId: number, receivedAt: string, seconds = 60, finished = true) {
  c.db.run(
    "INSERT INTO events (device_id, client_event_id, story_id, type, ts, received_at, payload_json) VALUES ('d', ?, ?, 'story_closed', 0, ?, ?)",
    [
      `${storyId}-${receivedAt}`,
      storyId,
      receivedAt,
      JSON.stringify({ active_seconds: seconds, pages_total: 2, max_page: finished ? 2 : 1, finished }),
    ],
  );
}

describe("milestones", () => {
  it("steps through the list, then every 100", () => {
    expect(milestoneFor(9)).toBeNull();
    expect(milestoneFor(10)).toBe(10);
    expect(milestoneFor(49)).toBe(25);
    expect(milestoneFor(50)).toBe(50);
    expect(milestoneFor(499)).toBe(400);
    expect(milestoneFor(512)).toBe(500);
    expect(milestoneFor(731)).toBe(700);
    expect(nextMilestone(null)).toBe(10);
    expect(nextMilestone(50)).toBe(75);
    expect(nextMilestone(700)).toBe(800);
  });
});

describe("share view", () => {
  it("is empty but well formed before any reading", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const v = shareView(ctx, TODAY);
    expect(v.today).toBe(TODAY);
    expect(v.fortnight).toHaveLength(14);
    expect(v.week.days).toHaveLength(7);
    expect(v.today_read).toEqual({ stories: [], minutes: 0, in_paper: 6 });
    expect(v.total_read).toBe(0);
    expect(v.milestone).toBeNull();
    expect(v.words).toEqual([]);
    expect(v.ask).toEqual({ date: null, stories: [] });
  });

  it("collects today, the week, the milestone, words and questions", async () => {
    ctx = makeCtx();
    await generate(ctx, "2026-11-13", NOW);
    await generate(ctx, TODAY, NOW);
    const older = ctx.db.storiesFor("2026-11-13", 1).map((r) => Number(r.id));
    const today = ctx.db.storiesFor(TODAY, 1).map((r) => Number(r.id));

    // Six yesterday, four this morning: the tenth different story is today's fourth.
    older.forEach((id, i) => closed(ctx!, id, `2026-11-13T07:0${i}:00+00:00`));
    closed(ctx, older[0], "2026-11-14T06:30:00+00:00"); // a re-read counts once towards the total
    today.slice(0, 4).forEach((id, i) => closed(ctx!, id, `2026-11-14T07:0${i}:00+00:00`, 120));
    closed(ctx, today[4], "2026-11-14T07:30:00+00:00", 30, false); // opened, not finished

    const v = shareView(ctx, TODAY);
    expect(v.total_read).toBe(10);
    expect(v.streak).toMatchObject({ current: 2, current_since: "2026-11-13" });

    expect(v.today_read.stories.map((s) => s.id)).toEqual([older[0], ...today.slice(0, 4)]);
    expect(v.today_read.in_paper).toBe(6);
    expect(v.today_read.minutes).toBe(9.5);

    expect(v.week.total_read).toBe(11);
    expect(v.week.reading_days).toBe(2);
    expect(v.week.top_topics.length).toBeGreaterThan(0);

    expect(v.milestone).toMatchObject({ stories: 10, date: TODAY, next: 25 });
    expect(v.milestone!.story!.id).toBe(today[3]);

    expect(v.ask.date).toBe(TODAY);
    expect(v.ask.stories.map((s) => s.id)).toEqual([older[0], today[0], today[1]]);

    const words = v.words.map((w) => w.word.toLowerCase());
    expect(new Set(words).size).toBe(words.length);
    expect(words.length).toBeLessThanOrEqual(4);
  });

  it("asks about the latest reading day when nothing is read today", async () => {
    ctx = makeCtx();
    await generate(ctx, "2026-11-12", NOW);
    const ids = ctx.db.storiesFor("2026-11-12", 1).map((r) => Number(r.id));
    closed(ctx, ids[0], "2026-11-12T07:00:00+00:00");
    closed(ctx, ids[1], "2026-11-12T07:05:00+00:00");
    const v = shareView(ctx, TODAY);
    expect(v.today_read.stories).toEqual([]);
    expect(v.ask).toEqual({ date: "2026-11-12", stories: [expect.objectContaining({ id: ids[0] }), expect.objectContaining({ id: ids[1] })] });
  });

  it("is served at GET /api/dashboard/share", async () => {
    t = makeApp();
    const res = await t.agent.get("/api/dashboard/share");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ today: TODAY, total_read: 0, milestone: null });
  });
});
