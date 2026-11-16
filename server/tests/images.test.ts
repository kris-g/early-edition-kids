import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { addArticle } from "../src/articles.js";
import { parseConfig } from "../src/config.js";
import { parseFeed } from "../src/feeds.js";
import { downloadFirstImage, httpFetchImage, pageImages, sniffImage, tidyAlt } from "../src/images.js";
import { LLMUnavailable, StubLLM } from "../src/llm.js";
import { generate, storyImageFile } from "../src/pipeline.js";
import { addDays } from "../src/timeutil.js";
import {
  ADMIN,
  NOW,
  TINY_IMAGES,
  TODAY,
  exampleConfigData,
  fakeArticleHtml,
  fixtureImageFetcher,
  makeApp,
  makeCtx,
  type TestApp,
} from "./helpers.js";

class DownLLM extends StubLLM {
  override async chat(): Promise<string> {
    throw new LLMUnavailable("connection refused");
  }
}

/** The fixture article page with an og:image (and its alt) in the head. */
const pageWithPhoto = (url: string, extra = "") =>
  fakeArticleHtml(url).replace(
    "<head>",
    `<head><meta property="og:image" content="/images/${encodeURIComponent(url.split("/").pop() || "x")}.jpg"><meta property="og:image:alt" content="A turtle swimming up for air">${extra}`,
  );

let t: TestApp | undefined;
let ctx: ReturnType<typeof makeCtx> | undefined;
let server: Server | undefined;
afterEach(() => {
  t?.cleanup();
  t = undefined;
  ctx?.cleanup();
  ctx = undefined;
  server?.close();
  server = undefined;
});

describe("finding a story's photo", () => {
  it("knows JPEG, PNG and WebP by their first bytes", () => {
    expect(sniffImage(TINY_IMAGES.jpg)).toBe("jpg");
    expect(sniffImage(TINY_IMAGES.png)).toBe("png");
    expect(sniffImage(TINY_IMAGES.webp)).toBe("webp");
    expect(sniffImage(Buffer.from("GIF89a........"))).toBeNull();
    expect(sniffImage(Buffer.from("<svg xmlns="))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it("prefers og:image with its alt, then twitter:image, resolving relative addresses", () => {
    const html = `<html><head>
      <meta name="twitter:image" content="https://cdn.example/t.png">
      <meta property="og:image" content="/pics/lead.jpg">
      <meta property="og:image:alt" content="  Players   celebrate  ">
    </head><body></body></html>`;
    expect(pageImages(html, "https://news.example/sport/1")).toEqual([
      { url: "https://news.example/pics/lead.jpg", alt: "Players celebrate" },
      { url: "https://cdn.example/t.png", alt: null },
    ]);
    expect(pageImages("<html><head></head></html>", "https://news.example/")).toEqual([]);
    expect(pageImages('<meta property="og:image" content="javascript:alert(1)">', "https://news.example/")).toEqual([]);
  });

  it("reads the feed item's own image: media:content, else the widest thumbnail, else an enclosure", () => {
    const feed = parseConfig({ feeds: [{ name: "F", url: "https://f.example/rss" }] }).feeds[0];
    const xml = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
      <item><title>One</title><link>https://f.example/1</link>
        <media:content url="https://f.example/1-video.mp4" type="video/mp4"/>
        <media:content url="https://f.example/1.jpg" medium="image" width="800"><media:description>A rocket on its tower</media:description></media:content></item>
      <item><title>Two</title><link>https://f.example/2</link>
        <media:thumbnail url="https://f.example/2-small.jpg" width="240"/>
        <media:thumbnail url="https://f.example/2-big.jpg" width="976"/></item>
      <item><title>Three</title><link>https://f.example/3</link>
        <enclosure url="https://f.example/3.mp3" type="audio/mpeg" length="1"/>
        <enclosure url="https://f.example/3.png" type="image/png" length="1"/></item>
      <item><title>Four</title><link>https://f.example/4</link></item>
    </channel></rss>`;
    expect(parseFeed(xml, feed).map((i) => i.image)).toEqual([
      { url: "https://f.example/1.jpg", alt: "A rocket on its tower" },
      { url: "https://f.example/2-big.jpg", alt: null },
      { url: "https://f.example/3.png", alt: null },
      null,
    ]);
  });

  it("keeps the first image that downloads and really is one; never throws", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/html")) return { bytes: Buffer.from("<html>"), contentType: "image/jpeg" };
      if (url.endsWith("/lies")) return { bytes: TINY_IMAGES.png, contentType: "image/jpeg" };
      if (url.endsWith("/gone")) throw new Error("HTTP 404");
      return { bytes: TINY_IMAGES.webp, contentType: "image/webp; charset=binary" };
    };
    const refs = ["/gone", "/html", "/lies", "/gone", "/ok"].map((p) => ({ url: `https://i.example${p}`, alt: "Alt" }));
    const got = await downloadFirstImage(refs, fetcher);
    expect(got).toMatchObject({ ext: "webp", alt: "Alt", url: "https://i.example/ok" });
    expect(calls).toEqual(["https://i.example/gone", "https://i.example/html", "https://i.example/lies", "https://i.example/ok"]);
    expect(await downloadFirstImage(refs.slice(0, 3), fetcher)).toBeNull();
    expect(await downloadFirstImage([], fetcher)).toBeNull();
  });

  it("skips an image whose description has a blocked word, and trims long alt text", async () => {
    const fetcher = fixtureImageFetcher();
    const refs = [
      { url: "https://i.example/a.jpg", alt: "A scary crash on the motorway" },
      { url: "https://i.example/b.png", alt: "x ".repeat(400) },
    ];
    const got = await downloadFirstImage(refs, fetcher, { blocklist: ["crash"] });
    expect(got?.url).toBe("https://i.example/b.png");
    expect(got!.alt!.length).toBeLessThanOrEqual(301);
    expect(tidyAlt("   ")).toBeNull();
  });
});

describe("downloading over HTTP", () => {
  const serve = async (handler: Parameters<typeof createServer>[1]) => {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  it("accepts JPEG, PNG and WebP within the size cap, and refuses other types and big files", async () => {
    const base = await serve((req, res) => {
      if (req.url === "/ok.png") {
        res.writeHead(200, { "Content-Type": "image/png" }).end(TINY_IMAGES.png);
      } else if (req.url === "/svg") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" }).end("<svg/>");
      } else if (req.url === "/declared-big") {
        res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(10 * 1024 * 1024) });
        res.end();
      } else if (req.url === "/streamed-big") {
        res.writeHead(200, { "Content-Type": "image/jpeg" });
        res.write(Buffer.alloc(3000));
        res.end(Buffer.alloc(3000));
      } else {
        res.writeHead(404).end();
      }
    });
    const ok = await httpFetchImage(`${base}/ok.png`);
    expect(ok.contentType).toBe("image/png");
    expect(ok.bytes.equals(TINY_IMAGES.png)).toBe(true);
    await expect(httpFetchImage(`${base}/svg`)).rejects.toThrow(/not a JPEG/);
    await expect(httpFetchImage(`${base}/declared-big`)).rejects.toThrow(/too large/);
    await expect(httpFetchImage(`${base}/streamed-big`, { maxBytes: 4000 })).rejects.toThrow(/too large/);
    await expect(httpFetchImage(`${base}/missing.jpg`)).rejects.toThrow(/404/);
    await expect(httpFetchImage("file:///etc/passwd")).rejects.toThrow(/non-http/);
  });
});

describe("photos in the paper", () => {
  it("stores each story's photo beside its file and serves it under every mount; the Kindle page has none", async () => {
    const calls: string[] = [];
    t = makeApp({ pageFetcher: async (url) => pageWithPhoto(url), imageFetcher: fixtureImageFetcher(calls) });
    expect((await request(t.app).post("/admin/generate").set(ADMIN)).status).toBe(200);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.stories.length).toBe(6);
    for (const s of issue.stories) {
      expect(s.image).toEqual({ path: s.path.replace(/\.html$/, ".jpg"), alt: "A turtle swimming up for air" });
      const img = await request(t.app).get(s.image.path);
      expect(img.status).toBe(200);
      expect(img.headers["content-type"]).toBe("image/jpeg");
      expect(Buffer.from(img.body).equals(TINY_IMAGES.jpg)).toBe(true);
      expect((await request(t.app).get(`/p/default${s.image.path}`)).status).toBe(200);
      // The wrong extension, and the Kindle's story page, carry no photo.
      expect((await request(t.app).get(s.image.path.replace(".jpg", ".png"))).status).toBe(404);
      const page = await request(t.app).get(s.path);
      expect(page.text).not.toMatch(/<img/i);
    }
    // Downloaded once per story, from the article page (resolved against it).
    expect(calls.length).toBe(6);
    expect(calls.every((u) => u.startsWith("https://"))).toBe(true);
    // Not on the dashboard port.
    expect((await t.agent.get(issue.stories[0].image.path)).status).toBe(404);
  });

  it("shows the parent the same photo on the dashboard's story page", async () => {
    t = makeApp({ pageFetcher: async (url) => pageWithPhoto(url), imageFetcher: fixtureImageFetcher() });
    await request(t.app).post("/admin/generate").set(ADMIN);
    const id = (await request(t.app).get("/api/issue/today")).body.stories[0].id;
    const detail = (await t.agent.get(`/api/dashboard/stories/${id}`)).body;
    expect(detail.image).toEqual({ alt: "A turtle swimming up for air" });
    const img = await t.agent.get(`/api/dashboard/stories/${id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
  });

  it("falls back to the feed's own image, and publishes without a photo when there is none", async () => {
    // The fixture pages have no og:image; the fixture feeds carry media images.
    t = makeApp({ imageFetcher: fixtureImageFetcher() });
    await request(t.app).post("/admin/generate").set(ADMIN);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    const rows = t.ctx.db.storiesFor(TODAY, 1);
    for (const s of issue.stories) {
      const row = rows.find((r) => Number(r.id) === s.id)!;
      if (row.image_url) expect(row.image_url).toMatch(/^https:\/\/(ichef\.bbci\.co\.uk|www\.snexplores\.org)\//);
      expect(s.image === null || s.image.alt === null).toBe(true);
    }
    expect(issue.stories.some((s: any) => s.image)).toBe(true);

    // Every download failing is not an error: the paper is the same, with no photos.
    const t2 = makeApp();
    try {
      await request(t2.app).post("/admin/generate").set(ADMIN);
      const plain = (await request(t2.app).get("/api/issue/today")).body;
      expect(plain.stories.length).toBe(6);
      expect(plain.stories.every((s: any) => s.image === null)).toBe(true);
    } finally {
      t2.cleanup();
    }
  });

  it("gives a regenerated version its own copies, and a catch-up story its source's photo", async () => {
    ctx = makeCtx({ pageFetcher: async (url: string) => pageWithPhoto(url), imageFetcher: fixtureImageFetcher() });
    const yesterday = addDays(TODAY, -1);
    await generate(ctx, yesterday, new Date(NOW.getTime() - 86400_000));
    const forced = await generate(ctx, yesterday, new Date(NOW.getTime() - 86400_000), true);
    expect(forced.version).toBe(2);
    for (const v of [1, 2]) {
      for (const r of ctx.db.storiesFor(yesterday, v)) {
        expect(r.image_ext).toBe("jpg");
        expect(existsSync(storyImageFile(ctx.settings, yesterday, v, Number(r.position), "jpg"))).toBe(true);
      }
    }
    ctx.writer = new DownLLM();
    ctx.checker = ctx.writer;
    const result = await generate(ctx, TODAY, NOW);
    expect(result.fallback).toBe(true);
    const copies = ctx.db.storiesFor(TODAY, 1);
    expect(copies.length).toBeGreaterThan(0);
    for (const c of copies) {
      const source = ctx.db.getStory(Number(c.reused_from))!;
      expect(c.image_ext).toBe(source.image_ext);
      expect(c.image_alt).toBe(source.image_alt);
      const file = storyImageFile(ctx.settings, TODAY, 1, Number(c.position), "jpg");
      const from = storyImageFile(ctx.settings, source.issue_date, Number(source.issue_version), Number(source.position), "jpg");
      expect(readFileSync(file).equals(readFileSync(from))).toBe(true);
      expect(file).not.toBe(from);
    }
  });

  it("finds the photo of a parent-added article from the page it already fetched", async () => {
    let pageCalls = 0;
    ctx = makeCtx({
      pageFetcher: async (url: string) => {
        pageCalls++;
        return pageWithPhoto(url, '<meta property="og:title" content="Penguins learn to skate">');
      },
      imageFetcher: fixtureImageFetcher(),
    });
    await generate(ctx, TODAY, NOW);
    pageCalls = 0;
    const r = await addArticle(ctx, { url: "https://e.test/penguins-skate", when: "today", now: NOW });
    expect(r.ok).toBe(true);
    const row = ctx.db.getStory(r.storyId!)!;
    expect(row.image_ext).toBe("jpg");
    expect(row.image_url).toBe("https://e.test/images/penguins-skate.jpg");
    expect(pageCalls).toBe(1);
  });
});

describe("the iPad reader's settings", () => {
  it("validates reader_mode, defaulting to pages", () => {
    expect(parseConfig({}).readerMode).toBe("pages");
    expect(parseConfig({ reader_mode: "scroll" }).readerMode).toBe("scroll");
    expect(() => parseConfig({ reader_mode: "book" })).toThrow("config: reader_mode: must be pages or scroll");
    expect(exampleConfigData().reader_mode ?? "pages").toBe("pages");
  });
});
