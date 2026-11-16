import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { LLMUnavailable, StubLLM, type ChatMessage } from "../src/llm.js";
import { NOW, generateReq, makeApp, postEvents, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const story = (sid: number, type: string, ceid: string, payload: Record<string, unknown> = {}) => ({
  client_event_id: ceid,
  story_id: sid,
  type,
  ts: 1,
  payload,
});

describe("Kindle API", () => {
  it("answers /healthz", async () => {
    t = makeApp();
    const r = await request(t.app).get("/healthz");
    expect(r.status).toBe(200);
    expect(r.text).toBe("ok");
  });

  it("404s today before generation", async () => {
    t = makeApp();
    const r = await request(t.app).get("/api/issue/today");
    expect(r.status).toBe(404);
    expect(r.body.detail).toBeTruthy();
  });

  it("generates, then serves today and the story files", async () => {
    t = makeApp();
    const r = await generateReq(t);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ date: "2026-11-14", version: 1, fallback: false, story_count: 6, status: "created" });

    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.date).toBe("2026-11-14");
    expect(issue.version).toBe(1);
    expect(issue.fallback).toBe(false);
    expect(issue.title).toBe("Early Edition");
    expect(issue.hidden).toEqual([]);
    expect(issue.stories.length).toBe(6);
    for (const [i, s] of issue.stories.entries()) {
      expect(Object.keys(s).sort()).toEqual(["id", "image", "kindle_image", "minutes", "path", "position", "teaser", "title", "topic", "word_to_know"]);
      expect(s.position).toBe(i + 1);
      expect(s.minutes).toBeGreaterThanOrEqual(1);
      expect(s.path).toBe(`/issues/2026-11-14/v1/${i + 1}.html`);
      const page = await request(t.app).get(s.path);
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(page.text).toContain(`<title>${s.topic} · `);
      for (const banned of ["<script", "<a ", "<img"]) expect(page.text).not.toContain(banned);
    }
    expect((await request(t.app).get("/api/issue/2026-11-14")).body).toEqual(issue);
    expect((await generateReq(t)).body.status).toBe("exists");
  });

  it("never returns an older issue as today", async () => {
    t = makeApp();
    await generateReq(t);
    t.clock.now = new Date(NOW.getTime() + 86400_000);
    expect((await request(t.app).get("/api/issue/today")).status).toBe(404);
    expect((await request(t.app).get("/api/issue/2026-11-14")).status).toBe(200);
    expect((await request(t.app).get("/api/issue/2026-11-15")).status).toBe(404);
    expect((await request(t.app).get("/api/issue/not-a-date")).status).toBe(404);
  });

  it("requires the admin token", async () => {
    t = makeApp();
    expect((await request(t.app).post("/admin/generate")).status).toBe(403);
    expect((await request(t.app).post("/admin/generate").set("X-Admin-Token", "nope")).status).toBe(403);
  });

  it("keeps events when an issue is regenerated", async () => {
    t = makeApp();
    await generateReq(t);
    const v1 = (await request(t.app).get("/api/issue/today")).body;
    const sid = v1.stories[0].id;
    expect((await postEvents(t, [story(sid, "story_opened", "a")])).body).toEqual({ accepted: ["a"] });

    const r = await generateReq(t, { force: "true" });
    expect(r.body.version).toBe(2);
    expect(r.body.status).toBe("created");
    const v2 = (await request(t.app).get("/api/issue/today")).body;
    expect(v2.version).toBe(2);
    expect(v2.stories.some((s: any) => v1.stories.map((x: any) => x.id).includes(s.id))).toBe(false);
    // The old story file and row still resolve, and events against old ids are still accepted.
    expect((await request(t.app).get(v1.stories[0].path)).status).toBe(200);
    const closed = story(sid, "story_closed", "b", { active_seconds: 80, pages_total: 2, max_page: 2, finished: true });
    expect((await postEvents(t, [closed])).body).toEqual({ accepted: ["b"] });
    const old = (await t.agent.get(`/api/dashboard/stories/${sid}`)).body;
    expect(old.version).toBe(1);
    expect(old.stats.opened).toBe(true);
    expect(old.stats.reached_end).toBe(true);
  });

  it("stores events idempotently", async () => {
    t = makeApp();
    await generateReq(t);
    const sid = (await request(t.app).get("/api/issue/today")).body.stories[0].id;
    const events = [
      { client_event_id: "e1", story_id: null, type: "issue_downloaded", ts: 100, payload: { date: "2026-11-14", version: 1 } },
      { client_event_id: "e2", story_id: null, type: "list_shown", ts: 101, payload: { date: "2026-11-14", version: 1 } },
      { client_event_id: "e3", story_id: sid, type: "story_opened", ts: 102, payload: {} },
      { client_event_id: "e4", story_id: sid, type: "story_closed", ts: 200, payload: { active_seconds: 95, pages_total: 2, max_page: 2, finished: true } },
    ];
    const first = await postEvents(t, events);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ accepted: ["e1", "e2", "e3", "e4"] });
    expect((await postEvents(t, events)).body).toEqual({ accepted: ["e1", "e2", "e3", "e4"] });
    expect(t.ctx.db.queryOne("SELECT COUNT(*) AS n FROM events")!.n).toBe(4);
    const row = t.ctx.db.queryOne("SELECT * FROM events WHERE client_event_id = 'e4'")!;
    expect(row.ts).toBe(200);
    expect(row.received_at).toBeTruthy();
    expect(row.device_id).toBe("device-1");
    // The same client_event_id from another device is a different event.
    expect((await postEvents(t, events.slice(0, 1), "device-2")).body).toEqual({ accepted: ["e1"] });
    expect(t.ctx.db.queryOne("SELECT COUNT(*) AS n FROM events")!.n).toBe(5);
  });

  it("does not accept unknown stories or types", async () => {
    t = makeApp();
    await generateReq(t);
    const sid = (await request(t.app).get("/api/issue/today")).body.stories[0].id;
    const r = await postEvents(t, [
      { client_event_id: "x1", story_id: 999999, type: "story_opened", ts: 1, payload: {} },
      { client_event_id: "x2", story_id: sid, type: "page_turned", ts: 1, payload: {} },
      { client_event_id: "x3", story_id: null, type: "story_opened", ts: 1, payload: {} },
      { client_event_id: "x4", story_id: sid, type: "story_opened", ts: 1 },
    ]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ accepted: ["x4"] });
  });

  it("limits event requests", async () => {
    t = makeApp();
    expect((await request(t.app).post("/api/events").send({ events: [] })).status).toBe(422);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ client_event_id: String(i), type: "list_shown", payload: {} }));
    expect((await postEvents(t, tooMany)).status).toBe(413);
  });

  it("removes a hidden story from the API and lists it in hidden", async () => {
    t = makeApp();
    await generateReq(t);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    const target = issue.stories[2];
    const r = await t.agent.post(`/api/dashboard/stories/${target.id}/hide`).set("X-Early-Edition", "1");
    expect(r.status).toBe(200);
    expect(r.body.hidden).toBe(true);
    const after = (await request(t.app).get("/api/issue/today")).body;
    expect(after.hidden).toEqual([target.id]);
    expect(after.stories.map((s: any) => s.id)).not.toContain(target.id);
    expect(after.stories.map((s: any) => s.position)).toEqual([1, 2, 4, 5, 6]); // not renumbered
    expect((await request(t.app).get(target.path)).status).toBe(200); // file still served
    await t.agent.post(`/api/dashboard/stories/${target.id}/unhide`).set("X-Early-Edition", "1");
    expect((await request(t.app).get("/api/issue/today")).body).toEqual(issue);
  });

  it("returns 503 failed when nothing could be published", async () => {
    class Down extends StubLLM {
      override async chat(): Promise<string> {
        throw new LLMUnavailable("down");
      }
    }
    t = makeApp({ writer: new Down() });
    const r = await generateReq(t);
    expect(r.status).toBe(503);
    expect(r.body.status).toBe("failed");
    expect((await request(t.app).get("/api/issue/today")).status).toBe(404);
  });

  it("answers /healthz while a run is in progress, and serialises concurrent runs", async () => {
    class Slow extends StubLLM {
      override async chat(messages: ChatMessage[], opts: { task: string; context?: Record<string, any> }) {
        await new Promise((r) => setTimeout(r, 30));
        return super.chat(messages, opts);
      }
    }
    t = makeApp({ writer: new Slow() });
    let finished = 0;
    const runs = [generateReq(t), generateReq(t)].map((p) => p.then((r) => (finished++, r)));
    await new Promise((r) => setTimeout(r, 40));
    const start = Date.now();
    const h = await request(t.app).get("/healthz");
    expect(h.text).toBe("ok");
    expect(Date.now() - start).toBeLessThan(500);
    expect(finished).toBe(0); // health answered mid-run
    const results = await Promise.all(runs);
    expect(results.map((r) => r.body.status).sort()).toEqual(["created", "exists"]);
    expect(t.ctx.db.queryOne("SELECT COUNT(*) AS n FROM stories")!.n).toBe(6);
  });
});

describe("issue response: edition number, created_at, word_to_know", () => {
  it("numbers editions by date, not by version", async () => {
    t = makeApp();
    await generateReq(t, { date: "2026-11-12" });
    await generateReq(t, { date: "2026-11-12", force: "true" }); // a regenerate is still the same edition
    await generateReq(t, { date: "2026-11-13" });
    await generateReq(t);
    await generateReq(t, { force: "true" });
    const today = (await request(t.app).get("/api/issue/today")).body;
    expect(today.version).toBe(2);
    expect(today.number).toBe(3);
    expect((await request(t.app).get("/api/issue/2026-11-12")).body.number).toBe(1);
    expect((await request(t.app).get("/api/issue/2026-11-12")).body.version).toBe(2);
    expect((await request(t.app).get("/api/issue/2026-11-13")).body.number).toBe(2);
  });

  it("gives the first ever issue number 1 and a created_at for the version", async () => {
    t = makeApp();
    await generateReq(t);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.number).toBe(1);
    expect(Number.isNaN(Date.parse(issue.created_at))).toBe(false);
    expect(issue.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$/);
    // Every field the deployed plugin reads is still there.
    for (const k of ["date", "version", "fallback", "title", "stories", "hidden"]) expect(issue).toHaveProperty(k);
  });

  it("includes each story's word to know, or null", async () => {
    t = makeApp();
    await generateReq(t);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.stories[0].word_to_know).toEqual({ word: "practice", definition: "doing something again and again to get better at it" });
    const sid = issue.stories[1].id;
    t.ctx.db.run("UPDATE stories SET word_to_know = NULL WHERE id = ?", [sid]);
    const after = (await request(t.app).get("/api/issue/today")).body;
    expect(after.stories[1].word_to_know).toBeNull();
    expect(after.stories[0].word_to_know).not.toBeNull();
  });
});
