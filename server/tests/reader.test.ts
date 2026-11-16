import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { normaliseBaseUrl, parseProfiles } from "../src/config.js";
import { READER_CSP } from "../src/reader.js";
import { exampleConfigData, makeApp, tmpDir, type TestApp } from "./helpers.js";

const TWO = () =>
  parseProfiles({
    ...exampleConfigData(),
    profiles: [{ id: "older", reader_mode: "scroll" }, { id: "younger", child_age: 6, title: "Little <Edition> & Co", story_count: 4 }],
  });

/** A stand-in for reader/dist: the placeholders the real build carries, and one asset. */
function fakeReaderDir(): string {
  const dir = path.join(tmpDir(), "reader");
  mkdirSync(path.join(dir, "assets"), { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    '<!doctype html><html><head><title>__EEK_TITLE__</title><meta name="apple-mobile-web-app-title" content="__EEK_TITLE__"><link rel="manifest" href="manifest.webmanifest"></head><body></body></html>',
  );
  writeFileSync(path.join(dir, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(path.join(dir, "apple-touch-icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return dir;
}

let t: TestApp | undefined;
afterEach(() => {
  t?.cleanup();
  t = undefined;
});

describe("the iPad reader on the Kindle port", () => {
  it("says it is not built yet rather than failing", async () => {
    t = makeApp();
    const r = await request(t.app).get("/read/");
    expect(r.status).toBe(503);
    expect(r.text).toMatch(/npm run build in reader/);
  });

  it("is served at <mount>/read/ for every profile, with that profile's title, and never on the dashboard port", async () => {
    t = makeApp({ profiles: TWO(), settings: { readerDir: fakeReaderDir() } });
    for (const [url, title] of [
      ["/read/", "Early Edition"],
      ["/p/older/read/", "Early Edition"],
      ["/p/younger/read/", "Little &lt;Edition&gt; &amp; Co"],
    ]) {
      const r = await request(t.app).get(url);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"]).toMatch(/text\/html/);
      expect(r.headers["cache-control"]).toBe("no-cache");
      expect(r.headers["content-security-policy"]).toBe(READER_CSP);
      expect(r.text).toContain(`<title>${title}</title>`);
      expect(r.text).toContain(`content="${title}"`);
      expect(r.text).not.toContain("__EEK_TITLE__");
      expect((await t.agent.get(url)).status).not.toBe(200);
    }
    // Without the slash, relative paths would break: redirect, keeping the query.
    const bare = await request(t.app).get("/p/younger/read?x=1");
    expect(bare.status).toBe(301);
    expect(bare.headers.location).toBe("/p/younger/read/?x=1");
    expect((await request(t.app).get("/read")).headers.location).toBe("/read/");
    // Assets are long-lived; an unknown profile is a 404.
    const js = await request(t.app).get("/p/younger/read/assets/index-abc.js");
    expect(js.status).toBe(200);
    expect(js.headers["cache-control"]).toMatch(/immutable/);
    expect((await request(t.app).get("/p/younger/read/apple-touch-icon.png")).status).toBe(200);
    expect((await request(t.app).get("/p/nobody/read/")).status).toBe(404);
    expect((await request(t.app).get("/read/nothing-here.js")).status).toBe(404);
  });

  it("writes a web app manifest per mount", async () => {
    t = makeApp({ profiles: TWO(), settings: { readerDir: fakeReaderDir() } });
    const younger = await request(t.app).get("/p/younger/read/manifest.webmanifest");
    expect(younger.headers["content-type"]).toMatch(/application\/manifest\+json/);
    const m = JSON.parse(younger.text);
    expect(m).toMatchObject({
      name: "Little <Edition> & Co",
      start_url: "/p/younger/read/",
      scope: "/p/younger/read/",
      display: "standalone",
      theme_color: "#fafaf7",
    });
    expect(m.icons.map((i: any) => i.sizes)).toContain("180x180");
    const root = JSON.parse((await request(t.app).get("/read/manifest.webmanifest")).text);
    expect(root).toMatchObject({ name: "Early Edition", start_url: "/read/", scope: "/read/" });
  });

  it("tells the reader its profile, title, mode and age", async () => {
    t = makeApp({ profiles: TWO() });
    expect((await request(t.app).get("/api/reader")).body).toEqual({
      profile: "older",
      profile_root: true,
      title: "Early Edition",
      mode: "scroll",
      age: 8,
    });
    const younger = await request(t.app).get("/p/younger/api/reader");
    expect(younger.headers["cache-control"]).toBe("no-store");
    expect(younger.body).toEqual({ profile: "younger", profile_root: false, title: "Little <Edition> & Co", mode: "pages", age: 6 });
    expect((await t.agent.get("/api/reader")).status).toBe(404);
  });
});

describe("the Kindle port's address for the dashboard", () => {
  it("uses KINDLE_BASE_URL when set, else this request's host name with PORT", async () => {
    t = makeApp({ settings: { kindleBaseUrl: "http://192.168.1.227:8080" } });
    expect((await t.agent.get("/api/dashboard/profiles")).body).toMatchObject({
      kindle_base_url: "http://192.168.1.227:8080",
      kindle_base_url_derived: false,
    });
    t.cleanup();
    t = makeApp({ settings: { port: 18080 } });
    const derived = await t.agent.get("/api/dashboard/profiles").set("Host", "nas.local:8081");
    expect(derived.body).toMatchObject({ kindle_base_url: "http://nas.local:18080", kindle_base_url_derived: true });
  });

  it("tidies KINDLE_BASE_URL and ignores a value that is not an http address", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normaliseBaseUrl("http://192.168.1.227:8080/")).toBe("http://192.168.1.227:8080");
    expect(normaliseBaseUrl(" https://news.home.example/kids// ")).toBe("https://news.home.example/kids");
    expect(normaliseBaseUrl("")).toBe("");
    expect(normaliseBaseUrl(undefined)).toBe("");
    expect(normaliseBaseUrl("192.168.1.227:8080")).toBe("");
    expect(normaliseBaseUrl("ftp://x")).toBe("");
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
