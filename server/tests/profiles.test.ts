import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import YAML from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type EarlyEditionKidsApp } from "../src/app.js";
import { ConfigError, parseProfiles, type ProfilesConfig } from "../src/config.js";
import { StubLLM } from "../src/llm.js";
import { MARKER_FILE, profileFromArgs, resolveProfileLayout } from "../src/profiles.js";
import { backupTargets, main as backupMain } from "../src/backup.js";
import { Database } from "../src/db.js";
import { readingSince } from "../src/readingreset.js";
import { main as resetMain } from "../scripts/reset-reading.js";
import {
  ADMIN,
  Clock,
  SERVER_DIR,
  exampleConfigData,
  fixtureFeedFetcher,
  fixturePageFetcher,
  noNetworkImages,
  generateReq,
  makeApp,
  testSettings,
  tmpDir,
  type TestApp,
} from "./helpers.js";

/** The example config with a profiles list laid over it. */
function withProfiles(profiles: Array<Record<string, unknown>>): ProfilesConfig {
  return parseProfiles({ ...exampleConfigData(), profiles });
}

const TWO = () => withProfiles([{ id: "older" }, { id: "younger", child_age: 6, title: "Little Edition", story_count: 4 }]);

describe("profiles in the config", () => {
  it("is one implicit default profile without a profiles list", () => {
    const p = parseProfiles(exampleConfigData());
    expect(p.explicit).toBe(false);
    expect(p.profiles.map((x) => x.id)).toEqual(["default"]);
    expect(p.profiles[0].config.childAge).toBe(8);
  });

  it("lays each profile over the top level, lists replacing rather than adding", () => {
    const p = withProfiles([
      { id: "older" },
      { id: "younger", child_age: 6, blocklist: ["spiders"], favourite_players: [], topics: [{ name: "Animals and nature" }], feeds: [] },
    ]);
    const [older, younger] = p.profiles;
    expect(p.explicit).toBe(true);
    expect(older.config.childAge).toBe(8);
    expect(older.config.blocklist.length).toBeGreaterThan(10);
    expect(younger.config.childAge).toBe(6);
    expect(younger.config.blocklist).toEqual(["spiders"]);
    expect(younger.config.favouritePlayers).toEqual([]);
    expect(younger.config.topics.map((t) => t.name)).toEqual(["Animals and nature"]);
    // Not overridden: the top level's.
    expect(younger.config.storyWords).toEqual(older.config.storyWords);
    expect(younger.config.llmPrices).toEqual(older.config.llmPrices);
  });

  it("parses the commented-out example in config.example.yaml", () => {
    const text = readFileSync(path.join(SERVER_DIR, "config.example.yaml"), "utf8");
    const start = text.indexOf("# profiles:");
    expect(start).toBeGreaterThan(0);
    const uncommented = text.slice(0, start) + text.slice(start).replace(/^# ?/gm, "");
    const p = parseProfiles(YAML.parse(uncommented));
    expect(p.profiles.map((x) => x.id)).toEqual(["older", "younger"]);
    expect(p.profiles[1].config.storyWords).toEqual({ min: 80, max: 130 });
  });

  it("validates each merged profile like a whole config", () => {
    // The top-level feeds hint at Science, which this profile's topics leave out.
    expect(() => withProfiles([{ id: "younger", topics: [{ name: "Space" }] }])).toThrow(/profile 'younger'.*topic_hint/);
    expect(() => withProfiles([{ id: "younger", story_count: 0 }])).toThrow(/profile 'younger'/);
  });

  it("rejects bad, duplicate or missing ids and per-profile global keys", () => {
    expect(() => withProfiles([{ id: "Older" }])).toThrow(ConfigError);
    expect(() => withProfiles([{ id: "a b" }])).toThrow(ConfigError);
    expect(() => withProfiles([{ title: "x" }])).toThrow(/id/);
    expect(() => withProfiles([{ id: "older" }, { id: "older" }])).toThrow(/twice/);
    expect(() => withProfiles([])).toThrow(/at least one/);
    expect(() => withProfiles([{ id: "older", llm_prices: {} }])).toThrow(/top level/);
    expect(() => withProfiles([{ id: "older", openrouter_models: [] }])).toThrow(/top level/);
    expect(withProfiles([{ id: "kid-2" }]).profiles[0].id).toBe("kid-2");
  });
});

describe("where each profile's data lives", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const dataDir = () => {
    const d = tmpDir();
    dirs.push(d);
    return path.join(d, "data");
  };
  const marker = (d: string) => JSON.parse(readFileSync(path.join(d, MARKER_FILE), "utf8"));

  it("leaves a single-child setup exactly as it was, with no marker", () => {
    const d = dataDir();
    const l = resolveProfileLayout(d, ["default"], false);
    expect(l.root).toBe("default");
    expect(l.dirs.get("default")).toBe(d);
    expect(existsSync(path.join(d, MARKER_FILE))).toBe(false);
  });

  it("gives the root to the first listed profile the first time, and records it", () => {
    const d = dataDir();
    const l = resolveProfileLayout(d, ["older", "younger"], true);
    expect(l.root).toBe("older");
    expect(l.dirs.get("older")).toBe(d);
    expect(l.dirs.get("younger")).toBe(path.join(d, "profiles", "younger"));
    expect(marker(d)).toEqual({ root: "older" });
  });

  it("keeps the recorded owner when profiles are reordered or added in front", () => {
    const d = dataDir();
    resolveProfileLayout(d, ["older", "younger"], true);
    for (const ids of [["younger", "older"], ["baby", "younger", "older"]]) {
      const l = resolveProfileLayout(d, ids, true);
      expect(l.root).toBe("older");
      expect(l.dirs.get("older")).toBe(d);
      expect(l.dirs.get("younger")).toBe(path.join(d, "profiles", "younger"));
    }
    expect(marker(d)).toEqual({ root: "older" });
  });

  it("leaves the root data unused, with a warning, when its owner is removed", () => {
    const d = dataDir();
    resolveProfileLayout(d, ["older", "younger"], true);
    const l = resolveProfileLayout(d, ["younger"], true);
    expect(l.root).toBeNull();
    expect(l.dirs.get("younger")).toBe(path.join(d, "profiles", "younger"));
    expect(l.warning).toMatch(/belongs to profile 'older'.*left unused/);
    // Going back to no profiles list does not hand it to "default" either.
    const back = resolveProfileLayout(d, ["default"], false);
    expect(back.root).toBeNull();
    expect(back.dirs.get("default")).toBe(path.join(d, "profiles", "default"));
    expect(marker(d)).toEqual({ root: "older" });
  });

  it("refuses an unreadable marker rather than guessing", () => {
    const d = dataDir();
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, MARKER_FILE), "{nope");
    expect(() => resolveProfileLayout(d, ["older"], true)).toThrow(ConfigError);
  });

  it("never attaches one child's paper to another across restarts", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const settings = testSettings(dir);
    const clock = new Clock();
    const open = (profiles: ProfilesConfig): EarlyEditionKidsApp =>
      createApp({ settings, profiles, writer: new StubLLM(), feedFetcher: fixtureFeedFetcher, pageFetcher: fixturePageFetcher, imageFetcher: noNetworkImages, clock: clock.fn });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Today: one child, no profiles list.
    let k = open(parseProfiles(exampleConfigData()));
    await request(k.kindleApp).post("/admin/generate").set(ADMIN).expect(200);
    const first = (await request(k.kindleApp).get("/api/issue/today")).body;
    expect(first.profile).toBe("default");
    k.close();

    // A second child is added after the first: the first keeps the paper, at / and at /p/older.
    k = open(withProfiles([{ id: "older" }, { id: "younger" }]));
    const after = (await request(k.kindleApp).get("/api/issue/today")).body;
    expect(after.stories).toEqual(first.stories);
    expect([after.profile, after.profile_root]).toEqual(["older", true]);
    // The Kindle that knew this paper as "default" is still sending to the same paper.
    const ev = (profile: string, root: boolean) => ({
      device_id: "kindle-1",
      profile,
      profile_root: root,
      events: [{ client_event_id: `${profile}-${root}`, story_id: first.stories[0].id, type: "story_opened", ts: 1, payload: {} }],
    });
    expect((await request(k.kindleApp).post("/api/events").send(ev("default", true))).body.accepted).toEqual(["default-true"]);
    // Its events never land in another child's paper.
    expect((await request(k.kindleApp).post("/p/younger/api/events").send(ev("default", true))).status).toBe(409);
    expect((await request(k.kindleApp).post("/p/younger/api/events").send(ev("older", false))).status).toBe(409);
    expect((await request(k.kindleApp).post("/api/events").send(ev("younger", false))).status).toBe(409);
    expect((await request(k.kindleApp).post("/p/younger/api/events").send(ev("younger", false))).status).toBe(200);
    expect((await request(k.kindleApp).get("/p/older/api/issue/today")).body.stories).toEqual(first.stories);
    expect((await request(k.kindleApp).get("/p/younger/api/issue/today")).status).toBe(404);
    k.close();

    // Reordered: still the same owner.
    k = open(withProfiles([{ id: "younger" }, { id: "older" }]));
    expect((await request(k.kindleApp).get("/p/older/api/issue/today")).body.stories).toEqual(first.stories);
    expect((await request(k.kindleApp).get("/api/issue/today")).body.profile).toBe("older");
    expect((await request(k.kindleApp).get("/p/younger/api/issue/today")).status).toBe(404);
    k.close();

    // The owner removed: nobody gets that paper, and / no longer serves a paper.
    k = open(withProfiles([{ id: "younger" }]));
    expect(warn.mock.calls.flat().join(" ")).toMatch(/belongs to profile 'older'/);
    expect((await request(k.kindleApp).get("/p/younger/api/issue/today")).status).toBe(404);
    expect((await request(k.kindleApp).get("/api/issue/today")).status).toBe(404);
    k.close();

    // Back again: the paper is where it was.
    k = open(withProfiles([{ id: "younger" }, { id: "older" }]));
    expect((await request(k.kindleApp).get("/p/older/api/issue/today")).body.stories).toEqual(first.stories);
    k.close();
    warn.mockRestore();
  });
});

describe("several profiles on one server", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  it("mounts the Kindle routes per profile, joining the mount and the story path", async () => {
    t = makeApp({ profiles: TWO() });
    expect((await generateReq(t)).status).toBe(200);
    for (const mount of ["", "/p/older", "/p/younger"]) {
      const issue = (await request(t.app).get(`${mount}/api/issue/today`)).body;
      expect(issue.profile).toBe(mount === "/p/younger" ? "younger" : "older");
      expect(issue.profile_root).toBe(mount !== "/p/younger");
      for (const s of issue.stories) {
        expect(s.path).toMatch(/^\/issues\//); // never carries the /p/<id> prefix
        const page = await request(t.app).get(`${mount}${s.path}`);
        expect(page.status).toBe(200);
        expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
      }
    }
    const younger = (await request(t.app).get("/p/younger/api/issue/today")).body;
    expect(younger.title).toBe("Little Edition");
    expect(younger.stories.length).toBe(4);
    // Ids restart in each profile's own database.
    expect(younger.stories[0].id).toBe(1);
    expect((await request(t.app).get("/p/nobody/api/issue/today")).status).toBe(404);
    expect((await request(t.app).get("/p/younger/admin/generate")).status).toBe(404);
  });

  it("stores events in the profile they were sent to", async () => {
    t = makeApp({ profiles: TWO() });
    await generateReq(t);
    const id = (await request(t.app).get("/p/younger/api/issue/today")).body.stories[0].id;
    const r = await request(t.app)
      .post("/p/younger/api/events")
      .send({ device_id: "kindle-2", events: [{ client_event_id: "e1", story_id: id, type: "story_opened", ts: 1, payload: {} }] });
    expect(r.body.accepted).toEqual(["e1"]);
    const younger = t.profiles.find((p) => p.id === "younger")!.ctx.db;
    const older = t.profiles.find((p) => p.id === "older")!.ctx.db;
    expect(younger.query("SELECT * FROM events").length).toBe(1);
    expect(older.query("SELECT * FROM events").length).toBe(0);
  });

  it("generates every profile, reporting each, and can be limited to one", async () => {
    t = makeApp({ profiles: TWO() });
    const r = await generateReq(t);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      date: "2026-11-14",
      version: 1,
      fallback: false,
      story_count: 6,
      status: "created",
      profiles: {
        older: { date: "2026-11-14", version: 1, fallback: false, story_count: 6, status: "created" },
        younger: { date: "2026-11-14", version: 1, fallback: false, story_count: 4, status: "created" },
      },
    });
    const one = await generateReq(t, { profile: "younger", force: "true" });
    expect(one.body).toEqual({ date: "2026-11-14", version: 2, fallback: false, story_count: 4, status: "created" });
    expect((await generateReq(t, { profile: "nobody" })).status).toBe(404);
  });

  it("answers 503 when any profile fails", async () => {
    // The younger profile's feeds all fail and it has nothing to fall back on.
    t = makeApp({ profiles: withProfiles([{ id: "older" }, { id: "younger", feeds: [{ name: "Broken", url: "file:///nowhere/feed.xml" }] }]) });
    const r = await generateReq(t);
    expect(r.status).toBe(503);
    expect(r.body.status).toBe("created");
    expect(r.body.profiles.older.status).toBe("created");
    expect(r.body.profiles.younger.status).toBe("failed");
    expect(r.body.detail).toMatch(/^younger: /);
  });

  it("keeps the single-profile generate response exactly as it was", async () => {
    t = makeApp();
    const r = await generateReq(t);
    expect(Object.keys(r.body).sort()).toEqual(["date", "fallback", "status", "story_count", "version"]);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect([issue.profile, issue.profile_root]).toEqual(["default", true]);
    expect((await request(t.app).get("/p/default/api/issue/today")).status).toBe(200);
  });

  it("mounts the dashboard API per profile and lists the profiles", async () => {
    t = makeApp({ profiles: TWO() });
    await generateReq(t);
    expect((await t.agent.get("/api/dashboard/profiles")).body).toEqual({
      profiles: [
        { id: "older", title: "Early Edition" },
        { id: "younger", title: "Little Edition" },
      ],
      root: "older",
      login: false,
      kindle_base_url: "http://127.0.0.1:8080",
      kindle_base_url_derived: true,
    });
    const root = (await t.agent.get("/api/dashboard/summary")).body;
    const older = (await t.agent.get("/api/dashboard/p/older/summary")).body;
    const younger = (await t.agent.get("/api/dashboard/p/younger/summary")).body;
    expect(older.today.stories.map((s: any) => s.title)).toEqual(root.today.stories.map((s: any) => s.title));
    expect(younger.today.stories.length).toBe(4);
    const missing = await t.agent.get("/api/dashboard/p/nobody/summary");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBeTruthy();
    // The CSRF guard applies under /p/<id> too.
    expect((await t.agent.post("/api/dashboard/p/younger/topics/Space").send({ mode: "pin" })).status).toBe(403);
    // Settings are per profile: pinning in one leaves the other alone.
    await t.agent.post("/api/dashboard/p/younger/topics/Space").set("X-Early-Edition", "1").send({ mode: "pin" }).expect(200);
    const mode = async (p: string) => (await t.agent.get(`/api/dashboard${p}/topics`)).body.find((x: any) => x.name === "Space").mode;
    expect(await mode("/p/younger")).toBe("pin");
    expect(await mode("/p/older")).toBe(null);
  });

  it("keeps jobs per profile", async () => {
    t = makeApp({ profiles: TWO() });
    await generateReq(t);
    const job = await t.agent
      .post("/api/dashboard/p/younger/articles/add")
      .set("X-Early-Edition", "1")
      .send({ url: "https://example.com/news/a-story-about-otters", when: "tomorrow" });
    expect(job.status).toBe(202);
    await Promise.all(t.profiles.flatMap((p) => [...p.jobs.pending]));
    expect((await t.agent.get(`/api/dashboard/p/younger/jobs/${job.body.id}`)).body.status).toBe("done");
    expect((await t.agent.get(`/api/dashboard/p/older/jobs/${job.body.id}`)).status).toBe(404);
    expect((await t.agent.get(`/api/dashboard/jobs/${job.body.id}`)).status).toBe(404);
  });
});

describe("scripts and backups with profiles", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  function setup(profiles: Array<Record<string, unknown>> | null) {
    const dir = tmpDir();
    dirs.push(dir);
    const configPath = path.join(dir, "config.yaml");
    const data = exampleConfigData();
    writeFileSync(configPath, JSON.stringify(profiles ? { ...data, profiles } : data));
    return testSettings(dir, { configPath });
  }

  it("picks the root profile by default and another with --profile", () => {
    const settings = setup([{ id: "older" }, { id: "younger", child_age: 6 }]);
    const root = profileFromArgs(settings, []);
    expect(root.id).toBe("older");
    expect(root.settings.dataDir).toBe(settings.dataDir);
    const younger = profileFromArgs(settings, ["--since", "2026-11-01", "--profile", "younger"]);
    expect(younger.id).toBe("younger");
    expect(younger.config.childAge).toBe(6);
    expect(younger.settings.dataDir).toBe(path.join(settings.dataDir, "profiles", "younger"));
    expect(() => profileFromArgs(settings, ["--profile", "nobody"])).toThrow(/no profile 'nobody'/);
    expect(() => profileFromArgs(settings, ["--profile"])).toThrow(/needs an id/);
  });

  it("is the single profile without a profiles list", () => {
    const settings = setup(null);
    const p = profileFromArgs(settings, []);
    expect(p.id).toBe("default");
    expect(p.settings.dataDir).toBe(settings.dataDir);
  });

  it("resets reading in the chosen profile only", () => {
    const settings = setup([{ id: "older" }, { id: "younger" }]);
    const env = { ...process.env };
    process.env.EARLY_EDITION_KIDS_DATA_DIR = settings.dataDir;
    process.env.EARLY_EDITION_KIDS_CONFIG = settings.configPath;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(resetMain(["--since", "2026-11-10", "--profile", "younger"])).toBe(0);
      const younger = new Database(path.join(settings.dataDir, "profiles", "younger", "early-edition-kids.db"));
      younger.init();
      expect(readingSince(younger)).toBe("2026-11-10");
      younger.close();
      expect(existsSync(path.join(settings.dataDir, "early-edition-kids.db"))).toBe(false);
      expect(log.mock.calls.flat().join(" ")).toMatch(/^younger: /);
    } finally {
      process.env = env;
      log.mockRestore();
    }
  });

  it("backs up every profile's database beside the root one", () => {
    const dir = tmpDir();
    dirs.push(dir);
    const data = path.join(dir, "data");
    for (const db of [path.join(data, "early-edition-kids.db"), path.join(data, "profiles", "younger", "early-edition-kids.db")]) {
      const d = new Database(db);
      d.init();
      d.close();
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const target = path.join(dir, "backup", "early-edition-kids-2026-11-15.db");
    mkdirSync(path.dirname(target));
    expect(backupMain([target], { EARLY_EDITION_KIDS_DATA_DIR: data })).toBe(0);
    log.mockRestore();
    expect(existsSync(target)).toBe(true);
    expect(existsSync(path.join(dir, "backup", "early-edition-kids-2026-11-15.younger.db"))).toBe(true);
    expect(backupTargets(path.join(dir, "nothing"), target)).toEqual([]);
  });
});
