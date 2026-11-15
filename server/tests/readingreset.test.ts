import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { londonMidnight, readingSince, resetReading } from "../src/readingreset.js";
import { generateReq, makeApp, postEvents, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const closed = (sid: number, ceid: string, ts: number) => ({
  client_event_id: ceid, type: "story_closed", story_id: sid, ts, payload: { finished: true, active_seconds: 120 },
});

describe("reading reset", () => {
  it("finds London midnight in winter and summer", () => {
    expect(new Date(londonMidnight("2026-11-14") * 1000).toISOString()).toBe("2026-11-14T00:00:00.000Z");
    expect(new Date(londonMidnight("2026-07-14") * 1000).toISOString()).toBe("2026-07-13T23:00:00.000Z");
  });

  it("deletes older reading, records the date, and sends it with the paper", async () => {
    t = makeApp();
    await generateReq(t);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.reading_since).toBeNull();
    const [a, b] = issue.stories;
    const friday = londonMidnight("2026-11-13") + 20 * 3600;
    const saturday = londonMidnight("2026-11-14") + 9 * 3600;
    await postEvents(t, [closed(a.id, "fri-1", friday), closed(b.id, "sat-1", saturday)]);

    const dry = resetReading(t.ctx.db, "2026-11-14", true);
    expect(dry.eventsDeleted).toBe(1);
    expect(readingSince(t.ctx.db)).toBeNull();

    expect(resetReading(t.ctx.db, "2026-11-14").eventsDeleted).toBe(1);
    expect(readingSince(t.ctx.db)).toBe("2026-11-14");
    const left = t.ctx.db.query("SELECT client_event_id FROM events WHERE type = 'story_closed'").map((r) => r.client_event_id);
    expect(left).toEqual(["sat-1"]);
    expect((await request(t.app).get("/api/issue/today")).body.reading_since).toBe("2026-11-14");
  });

  it("accepts but drops reading from before the reset that arrives later", async () => {
    t = makeApp();
    await generateReq(t);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    resetReading(t.ctx.db, "2026-11-14");
    const late = await postEvents(t, [
      closed(issue.stories[0].id, "old-1", londonMidnight("2026-11-13") + 3600),
      closed(issue.stories[1].id, "new-1", londonMidnight("2026-11-14") + 3600),
    ]);
    expect(late.body.accepted.sort()).toEqual(["new-1", "old-1"]);
    const stored = t.ctx.db.query("SELECT client_event_id FROM events WHERE type = 'story_closed'").map((r) => r.client_event_id);
    expect(stored).toEqual(["new-1"]);
  });

  it("rejects a malformed date", () => {
    t = makeApp();
    expect(() => resetReading(t.ctx.db, "14/11/2026")).toThrow(/YYYY-MM-DD/);
  });
});
