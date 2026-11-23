import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import YAML from "yaml";
import { createApp, type AppOptions, type EarlyEditionKidsApp } from "../src/app.js";
import { makeSettings, parseConfig, type Config, type Settings } from "../src/config.js";
import { Database } from "../src/db.js";
import type { FetchedImage } from "../src/images.js";
import { StubLLM } from "../src/llm.js";
import { buildContext, type Context } from "../src/pipeline.js";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, "fixtures");
export const SERVER_DIR = path.resolve(HERE, "..");

// The fixture feeds were captured on Friday 13 November 2026 around 18:00 GMT.
// 05:30 London the next morning is when the CronJob would run.
export const NOW = new Date("2026-11-14T05:30:00Z");
export const TODAY = "2026-11-14";

export const FEED_FILES: Record<string, string> = {
  "https://feeds.bbci.co.uk/newsround/rss.xml": "newsround.xml",
  "https://www.snexplores.org/feed": "snexplores.xml",
  "https://feeds.bbci.co.uk/sport/football/rss.xml": "bbcfootball.xml",
  "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml": "bbcscience.xml",
};

export const ADMIN = { "X-Admin-Token": "test-admin" };

export function exampleConfigData(): any {
  return YAML.parse(readFileSync(path.join(SERVER_DIR, "config.example.yaml"), "utf8"));
}

export const exampleConfig = (): Config => parseConfig(exampleConfigData());

export async function fixtureFeedFetcher(url: string): Promise<Buffer> {
  return readFileSync(path.join(FIXTURES, FEED_FILES[url]));
}

/** A plausible article page with ~200 words and no digits, built from the URL slug. */
export function fakeArticleHtml(url: string): string {
  const slug = url.split("/").pop()!.toLowerCase().replace(/[^a-z]+/g, " ").trim() || "news";
  const paras = [
    `This is a pretend article page used in tests. It talks about the story called ${slug}.`,
    "Reporters spoke to people who were there and wrote down what they saw and heard. " +
      "Everyone agreed that it was an interesting thing to happen and that lots of people would like to know about it.",
    "Experts explained why the news matters. They said it could help us understand the world a little better " +
      "and that more work will be done to find out what happens next.",
    "Some people were surprised by the news, while others said they had expected something like this for a long time. " +
      "Either way, it got lots of people talking at home, at school and online.",
    "The people involved said they were proud of what they had done. They thanked their friends and families " +
      "for helping them, and they hoped other people would be inspired to try something new as well.",
  ];
  const body = paras.map((p) => `<p>${p}</p>`).join("");
  return `<html><head><title>x</title><meta property="og:title" content="Pretend page about ${slug}"><meta property="og:site_name" content="Example News"></head><body><nav><p>Home News Sport Weather</p></nav><article>${body}</article></body></html>`;
}

export async function fixturePageFetcher(url: string): Promise<string> {
  return fakeArticleHtml(url);
}

/** Every article page also says how many pupils and schools took part. */
export const pagesWithFigures = async (url: string) =>
  (await fixturePageFetcher(url)).replace("</article>", "<p>More than 1,300 pupils from 40 schools took part.</p></article>");

/** A writer that repeats both of those figures in the first paragraph. */
export class WithFigures extends StubLLM {
  override rewrite(ctx: Record<string, any>) {
    const story = super.rewrite(ctx);
    story.body[0] += " In all, 1,300 pupils from 40 schools came.";
    return story;
  }
}

/** The default in tests: no network, so every story simply has no photo. */
export async function noNetworkImages(url: string): Promise<FetchedImage> {
  throw new Error(`no network in tests (${url})`);
}

/** The smallest real JPEG, PNG and WebP headers, padded: enough for the type check. */
export const TINY_IMAGES = {
  jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]),
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]),
  webp: Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x40, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(60, 3)]),
};

/** Serves TINY_IMAGES by extension (`.jpg`, `.png`, `.webp` anywhere in the URL); anything else is a 404. */
export function fixtureImageFetcher(calls: string[] = []) {
  return async (url: string): Promise<FetchedImage> => {
    calls.push(url);
    const ext = (["jpg", "png", "webp"] as const).find((e) => url.includes(`.${e}`));
    if (!ext) throw new Error(`HTTP 404 for ${url}`);
    return { bytes: TINY_IMAGES[ext], contentType: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[ext] };
  };
}

/** The default in tests: the Sport page's feeds are never reached. */
export async function noNetworkSports(url: string): Promise<unknown> {
  throw new Error(`no network in tests (${url})`);
}

export class Clock {
  constructor(public now: Date = NOW) {}
  fn = () => this.now;
}

export function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "early-edition-kids-test-"));
}

export function testSettings(dir: string, overrides: Partial<Settings> = {}): Settings {
  return makeSettings({
    dataDir: path.join(dir, "data"),
    configPath: path.join(SERVER_DIR, "config.example.yaml"),
    llmBaseUrl: "stub",
    adminToken: "test-admin",
    webDir: path.join(dir, "no-web"),
    readerDir: path.join(dir, "no-reader"),
    ...overrides,
  });
}

export interface TestApp extends EarlyEditionKidsApp {
  dir: string;
  clock: Clock;
  /** The Kindle app (PORT). */
  app: EarlyEditionKidsApp["kindleApp"];
  /** The dashboard app (DASHBOARD_PORT). */
  agent: ReturnType<typeof request.agent>;
  cleanup(): void;
}

export function makeApp(
  opts: Omit<Partial<AppOptions>, "settings" | "clock"> & { settings?: Partial<Settings>; clock?: Clock } = {},
): TestApp {
  const dir = tmpDir();
  const clock = opts.clock ?? new Clock();
  const k = createApp({
    settings: testSettings(dir, opts.settings),
    config: opts.profiles ? undefined : (opts.config ?? exampleConfig()),
    profiles: opts.profiles,
    writer: opts.writer ?? new StubLLM(),
    checker: opts.checker,
    feedFetcher: opts.feedFetcher ?? fixtureFeedFetcher,
    pageFetcher: opts.pageFetcher ?? fixturePageFetcher,
    imageFetcher: opts.imageFetcher ?? noNetworkImages,
    sportsFetcher: opts.sportsFetcher ?? noNetworkSports,
    clock: clock.fn,
  });
  return {
    ...k,
    dir,
    clock,
    app: k.kindleApp,
    agent: request.agent(k.dashboardApp),
    cleanup() {
      k.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function makeCtx(overrides: Partial<Context> = {}): Context & { dir: string; cleanup(): void } {
  const dir = tmpDir();
  const settings = testSettings(dir);
  const db = new Database(path.join(settings.dataDir, "early-edition-kids.db"));
  db.init();
  const ctx = buildContext(settings, exampleConfig(), db, {
    writer: new StubLLM(),
    feedFetcher: fixtureFeedFetcher,
    pageFetcher: fixturePageFetcher,
    imageFetcher: noNetworkImages,
  });
  Object.assign(ctx, overrides);
  return Object.assign(ctx, {
    dir,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  });
}

export function postEvents(t: TestApp, events: unknown[], deviceId = "device-1") {
  return request(t.app).post("/api/events").send({ device_id: deviceId, events });
}

export function generateReq(t: TestApp, query: Record<string, string> = {}) {
  return request(t.app).post("/admin/generate").query(query).set(ADMIN);
}

/** Poll a dashboard job until it is no longer pending. */
export async function waitJob(t: TestApp, id: string) {
  for (let i = 0; i < 200; i++) {
    const r = await t.agent.get(`/api/dashboard/jobs/${id}`);
    if (r.body.status !== "pending") return r.body;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("job did not finish");
}
