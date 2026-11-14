import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { StubLLM } from "../src/llm.js";
import { generateReq, makeApp, postEvents, tmpDir, waitJob, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const H = { "X-Early-Edition": "1" };

const STORY_CARD_KEYS = [
  "added_by_parent", "date", "hidden", "id", "minutes", "position", "reused", "source_name", "source_title",
  "source_url", "stats", "teaser", "title", "topic", "version", "word_count",
].sort();

function expectStoryCard(c: any) {
  expect(Object.keys(c).sort()).toEqual(STORY_CARD_KEYS);
  expect(Object.keys(c.stats).sort()).toEqual(["active_seconds", "engaged", "expected_seconds", "opened", "reached_end"]);
}

describe("two ports, no login", () => {
  it("serves /healthz on both ports", async () => {
    t = makeApp();
    for (const app of [t.kindleApp, t.dashboardApp]) {
      const r = await request(app).get("/healthz");
      expect(r.status).toBe(200);
      expect(r.text).toBe("ok");
    }
  });

  it("keeps the dashboard off the Kindle port", async () => {
    t = makeApp();
    for (const p of ["/dashboard/", "/dashboard", "/api/dashboard/summary", "/api/dashboard/topics"]) {
      expect((await request(t.kindleApp).get(p)).status, p).toBe(404);
    }
    expect((await request(t.kindleApp).post("/api/dashboard/regenerate").set(H).send({})).status).toBe(404);
    expect((await request(t.kindleApp).get("/")).status).toBe(404);
  });

  it("keeps the Kindle routes off the dashboard port", async () => {
    t = makeApp();
    await generateReq(t);
    const path1 = (await request(t.kindleApp).get("/api/issue/today")).body.stories[0].path;
    for (const p of ["/api/issue/today", "/api/issue/2026-11-14", path1]) {
      expect((await request(t.dashboardApp).get(p)).status, p).toBe(404);
    }
    expect((await request(t.dashboardApp).post("/api/events").send({ device_id: "d", events: [] })).status).toBe(404);
    expect((await request(t.dashboardApp).post("/admin/generate").set("X-Admin-Token", "test-admin")).status).toBe(404);
  });

  it("redirects / to /dashboard/ on the dashboard port", async () => {
    t = makeApp();
    const r = await request(t.dashboardApp).get("/");
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("/dashboard/");
  });

  it("needs no login: every dashboard route answers without credentials", async () => {
    t = makeApp();
    await generateReq(t);
    const sid = (await request(t.kindleApp).get("/api/issue/today")).body.stories[0].id;
    for (const p of ["/summary", "/issues", "/issues/2026-11-14", `/stories/${sid}`, "/topics", "/articles/search", "/runs"]) {
      expect((await request(t.dashboardApp).get(`/api/dashboard${p}`)).status, p).toBe(200);
    }
    for (const p of ["/login", "/logout", "/me"]) {
      expect((await request(t.dashboardApp).post(`/api/dashboard${p}`).set(H).send({})).status, p).toBe(404);
    }
    expect((await request(t.dashboardApp).post(`/api/dashboard/stories/${sid}/hide`).set(H)).status).toBe(200);
  });

  it("returns 403 on POST without the X-Early-Edition header", async () => {
    t = makeApp();
    for (const p of ["/regenerate", "/stories/1/hide", "/topics/Space", "/articles/add"]) {
      const r = await t.agent.post(`/api/dashboard${p}`).send({});
      expect(r.status, p).toBe(403);
      expect(r.body.error).toBeTruthy();
    }
    expect(t.ctx.db.getIssue("2026-11-14")).toBeUndefined(); // the refused regenerate did nothing
  });
});

describe("dashboard routes", () => {
  it("summarises today, streak, the week and the last run", async () => {
    t = makeApp();
    const empty = (await t.agent.get("/api/dashboard/summary")).body;
    expect(empty).toEqual({
      today: null, streak: 0, week_read: 0, last_run: null, last_run_cost: null,
      streak_detail: { current: 0, current_since: null, longest: 0, longest_from: null, longest_to: null },
    });

    await generateReq(t);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    const sid = issue.stories[0].id;
    await postEvents(t, [
      { client_event_id: "d", type: "issue_downloaded", story_id: null, payload: { date: "2026-11-14", version: 1 } },
      { client_event_id: "s", type: "list_shown", story_id: null, payload: { date: "2026-11-14", version: 1 } },
      { client_event_id: "o", type: "story_opened", story_id: sid, payload: {} },
      { client_event_id: "c", type: "story_closed", story_id: sid, payload: { active_seconds: 300, pages_total: 2, max_page: 2, finished: true } },
    ]);
    const s = (await t.agent.get("/api/dashboard/summary")).body;
    expect(s.streak).toBe(1);
    expect(s.week_read).toBe(1);
    expect(Object.keys(s.last_run).sort()).toEqual(["date", "detail", "finished_at", "started_at", "status"]);
    expect(s.last_run.status).toBe("created");
    expect(s.last_run.detail.length).toBeGreaterThan(3);
    const v = s.today;
    expect(Object.keys(v).sort()).toEqual(["created_at", "date", "downloaded_by", "fallback", "read_count", "stories", "version"]);
    expect(v.read_count).toBe(1);
    expect(v.downloaded_by).toEqual([{ device: "device-1", version: 1, received_at: expect.any(String) }]);
    expect(v.stories.length).toBe(6);
    v.stories.forEach(expectStoryCard);
    expect(v.stories[0].stats).toEqual({ opened: true, reached_end: true, active_seconds: 300, expected_seconds: expect.any(Number), engaged: true });
    expect(v.stories[0].source_url).toContain("https://");
  });

  it("lists issues and shows one", async () => {
    t = makeApp();
    await generateReq(t);
    await generateReq(t, { date: "2026-11-13" });
    const list = (await t.agent.get("/api/dashboard/issues?limit=30")).body;
    expect(list.map((i: any) => i.date)).toEqual(["2026-11-14", "2026-11-13"]);
    expect(Object.keys(list[0]).sort()).toEqual(["date", "fallback", "read_count", "story_count", "version"]);
    expect(list[0].story_count).toBe(6);
    expect((await t.agent.get("/api/dashboard/issues?limit=1")).body.length).toBe(1);
    const one = (await t.agent.get("/api/dashboard/issues/2026-11-13")).body;
    expect(one.date).toBe("2026-11-13");
    expect((await t.agent.get("/api/dashboard/issues/2026-01-01")).status).toBe(404);
  });

  it("shows a story with its body, word to know and neighbours", async () => {
    t = makeApp();
    await generateReq(t);
    const ids = (await request(t.app).get("/api/issue/today")).body.stories.map((s: any) => s.id);
    const d = (await t.agent.get(`/api/dashboard/stories/${ids[1]}`)).body;
    expect(d.body_html).toContain("<h1>");
    expect(d.body_html).toContain("WORD TO KNOW");
    expect(d.body_html).not.toContain("<html");
    expect(d.body_html).not.toContain("<head");
    expect(d.body_html).not.toContain("<body");
    expect(d.word_to_know).toEqual({ word: "practice", definition: expect.any(String) });
    expect(d.think_about_it).toBeTruthy();
    expect(d.prev_id).toBe(ids[0]);
    expect(d.next_id).toBe(ids[2]);
    expect((await t.agent.get(`/api/dashboard/stories/${ids[0]}`)).body.prev_id).toBeNull();
    expect((await t.agent.get(`/api/dashboard/stories/${ids[5]}`)).body.next_id).toBeNull();
    expect((await t.agent.get("/api/dashboard/stories/99999")).status).toBe(404);
  });

  it("hides and unhides, returning the card", async () => {
    t = makeApp();
    await generateReq(t);
    const sid = (await request(t.app).get("/api/issue/today")).body.stories[0].id;
    const hidden = (await t.agent.post(`/api/dashboard/stories/${sid}/hide`).set(H)).body;
    expectStoryCard(hidden);
    expect(hidden.hidden).toBe(true);
    const summary = (await t.agent.get("/api/dashboard/summary")).body;
    expect(summary.today.stories.find((s: any) => s.id === sid).hidden).toBe(true); // still listed, flagged
    expect((await t.agent.post(`/api/dashboard/stories/${sid}/unhide`).set(H)).body.hidden).toBe(false);
  });

  it("regenerates, asking for confirmation once the Kindle has the issue", async () => {
    t = makeApp();
    const first = await t.agent.post("/api/dashboard/regenerate").set(H).send({});
    expect(first.body).toEqual({ date: "2026-11-14", version: 1, fallback: false, story_count: 6, status: "created" });
    expect((await t.agent.post("/api/dashboard/regenerate").set(H).send({})).body.version).toBe(2);
    await postEvents(t, [{ client_event_id: "d1", type: "issue_downloaded", story_id: null, payload: { date: "2026-11-14", version: 2 } }]);
    const r = await t.agent.post("/api/dashboard/regenerate").set(H).send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toBeTruthy();
    const ok = await t.agent.post("/api/dashboard/regenerate").set(H).send({ confirm: true });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(3);
  });

  it("lists topics and sets pin, block and clear", async () => {
    t = makeApp();
    const topics = (await t.agent.get("/api/dashboard/topics")).body;
    expect(topics.length).toBe(9);
    expect(topics.map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(["Liverpool FC", "England"]));
    expect(Object.keys(topics[0]).sort()).toEqual(
      ["base_weight", "effective_weight", "engaged", "engagement_rate", "mode", "name", "open_rate", "opened", "shown"].sort(),
    );
    const blocked = (await t.agent.post("/api/dashboard/topics/Weather").set(H).send({ mode: "block" })).body;
    expect(blocked.mode).toBe("block");
    expect(blocked.effective_weight).toBe(0);
    const pinned = (await t.agent.post(`/api/dashboard/topics/${encodeURIComponent("Animals and nature")}`).set(H).send({ mode: "pin" })).body;
    expect(pinned.mode).toBe("pin");
    expect(t.ctx.db.topicOverrides()).toEqual({ Weather: "block", "Animals and nature": "pin" });
    expect((await t.agent.post("/api/dashboard/topics/Weather").set(H).send({ mode: null })).body.mode).toBeNull();
    expect((await t.agent.post("/api/dashboard/topics/Politics").set(H).send({ mode: "pin" })).status).toBe(404);
    expect((await t.agent.post("/api/dashboard/topics/Space").set(H).send({ mode: "maybe" })).status).toBe(422);
  });

  it("lists runs", async () => {
    t = makeApp();
    await generateReq(t);
    await generateReq(t, { force: "true" });
    const runs = (await t.agent.get("/api/dashboard/runs?limit=10")).body;
    expect(runs.length).toBe(2);
    expect(runs[0].status).toBe("created");
    expect(runs[0].date).toBe("2026-11-14");
    expect(Array.isArray(runs[0].detail)).toBe(true);
    expect((await t.agent.get("/api/dashboard/runs?limit=1")).body.length).toBe(1);
  });
});

describe("articles API", () => {
  it("searches the archive", async () => {
    t = makeApp();
    await generateReq(t);
    const newest = (await t.agent.get("/api/dashboard/articles/search?q=")).body;
    expect(newest.length).toBe(30);
    expect(Object.keys(newest[0]).sort()).toEqual(["already_used", "published_at", "source_name", "summary", "title", "url"]);
    const kane = (await t.agent.get("/api/dashboard/articles/search?q=kane")).body;
    expect(kane.length).toBeGreaterThan(0);
    expect(kane.every((h: any) => `${h.title} ${h.summary}`.toLowerCase().includes("kane"))).toBe(true);
    const used = new Set((await request(t.app).get("/api/issue/today")).body.stories.map((s: any) => s.title));
    expect(newest.some((h: any) => h.already_used)).toBe(true);
    expect(used.size).toBe(6);
  });

  it("adds an article to today through a job", async () => {
    t = makeApp();
    await generateReq(t);
    const hit = (await t.agent.get("/api/dashboard/articles/search?q=penguin")).body[0];
    const r = await t.agent.post("/api/dashboard/articles/add").set(H).send({ url: hit.url, when: "today" });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ id: expect.any(String), status: "pending", when: "today", story: null, reasons: [] });
    const job = await waitJob(t, r.body.id);
    expect(job.status).toBe("done");
    expectStoryCard(job.story);
    expect(job.story.added_by_parent).toBe(true);
    expect(job.story.position).toBe(7);
    expect(job.story.version).toBe(1);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.version).toBe(1);
    expect(issue.stories.at(-1)).toMatchObject({ id: job.story.id, position: 7, path: "/issues/2026-11-14/v1/7.html" });
    expect((await request(t.app).get("/issues/2026-11-14/v1/7.html")).status).toBe(200);
    expect((await t.agent.get("/api/dashboard/jobs/nope")).status).toBe(404);
  });

  it("reports a failed check and does not add the story", async () => {
    class Unsafe extends StubLLM {
      override check() {
        return { safe: false, supported: true, reasons: ["too scary"] };
      }
    }
    t = makeApp();
    await generateReq(t);
    t.ctx.checker = new Unsafe();
    const hit = (await t.agent.get("/api/dashboard/articles/search?q=penguin")).body[0];
    const r = await t.agent.post("/api/dashboard/articles/add").set(H).send({ url: hit.url, when: "today" });
    const job = await waitJob(t, r.body.id);
    expect(job.status).toBe("failed");
    expect(job.story).toBeNull();
    expect(job.reasons.join(" ")).toContain("too scary");
    expect((await request(t.app).get("/api/issue/today")).body.stories.length).toBe(6);
  });

  it("validates the add request", async () => {
    t = makeApp();
    expect((await t.agent.post("/api/dashboard/articles/add").set(H).send({ url: "", when: "today" })).status).toBe(422);
    expect((await t.agent.post("/api/dashboard/articles/add").set(H).send({ url: "https://x.test/a", when: "later" })).status).toBe(422);
  });
});

describe("web app serving", () => {
  it("says the web app is not built when web/dist is missing", async () => {
    t = makeApp();
    const r = await request(t.dashboardApp).get("/dashboard/");
    expect(r.status).toBe(503);
    expect(r.text).toContain("web app not built");
    expect((await request(t.dashboardApp).get("/")).headers.location).toBe("/dashboard/");
    expect((await request(t.dashboardApp).get("/dashboard")).headers.location).toBe("/dashboard/");
  });

  it("serves files with SPA fallback and cache headers", async () => {
    const web = path.join(tmpDir(), "dist");
    mkdirSync(path.join(web, "assets"), { recursive: true });
    writeFileSync(path.join(web, "index.html"), "<!doctype html><title>app</title>");
    writeFileSync(path.join(web, "sw.js"), "self.addEventListener('fetch', () => {});");
    writeFileSync(path.join(web, "manifest.webmanifest"), "{}");
    writeFileSync(path.join(web, "assets", "index-abc123.js"), "console.log(1)");
    t = makeApp({ settings: { webDir: web } });

    const index = await request(t.dashboardApp).get("/dashboard/");
    expect(index.status).toBe(200);
    expect(index.text).toContain("<title>app</title>");
    expect(index.headers["cache-control"]).toBe("no-cache");
    const deep = await request(t.dashboardApp).get("/dashboard/stories/12");
    expect(deep.status).toBe(200);
    expect(deep.text).toContain("<title>app</title>");
    expect(deep.headers["cache-control"]).toBe("no-cache");
    expect((await request(t.dashboardApp).get("/dashboard/sw.js")).headers["cache-control"]).toBe("no-cache");
    expect((await request(t.dashboardApp).get("/dashboard/manifest.webmanifest")).headers["cache-control"]).toBe("no-cache");
    const asset = await request(t.dashboardApp).get("/dashboard/assets/index-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect((await request(t.dashboardApp).get("/dashboard/assets/missing.js")).status).toBe(404);
    // The API is not swallowed by the SPA.
    expect((await request(t.dashboardApp).get("/api/dashboard/topics")).status).toBe(200);
  });
});
