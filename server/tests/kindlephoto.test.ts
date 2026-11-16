import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { KINDLE_PHOTO, kindlePhoto, type FetchedImage } from "../src/images.js";
import { kindlePhotoFile } from "../src/kindlephoto.js";
import { storyImageFile } from "../src/pipeline.js";
import { ADMIN, TODAY, fakeArticleHtml, makeApp, type TestApp } from "./helpers.js";

/** A real photo-like image: a colour gradient with a dark square, `w` x `h`. */
async function picture(w: number, h: number, format: "jpeg" | "png" | "webp" = "jpeg"): Promise<Buffer> {
  const gradient = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g"><stop offset="0" stop-color="#3a7bd5"/><stop offset="1" stop-color="#f7b733"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/><rect x="${w / 3}" y="${h / 3}" width="${w / 4}" height="${h / 4}" fill="#222"/></svg>`,
  );
  return sharp(gradient)[format]().toBuffer();
}

const types = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const pageWithPhoto = (url: string) =>
  fakeArticleHtml(url).replace("<head>", `<head><meta property="og:image" content="/images/photo.img"><meta property="og:image:alt" content="A turtle">`);

function photoFetcher(bytes: Buffer, format: keyof typeof types) {
  return async (): Promise<FetchedImage> => ({ bytes, contentType: types[format] });
}

let t: TestApp | undefined;
afterEach(() => {
  t?.cleanup();
  t = undefined;
});

describe("the Kindle's copy of a photo", () => {
  it("is a grey baseline JPEG at the Kindle size, from JPEG, PNG and WebP", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const out = await kindlePhoto(await picture(1600, 1200, format));
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("jpeg");
      expect([meta.width, meta.height]).toEqual([KINDLE_PHOTO.width, KINDLE_PHOTO.height]);
      expect(meta.channels).toBe(1);
      expect(meta.isProgressive).toBe(false);
      expect(out.length).toBeLessThan(200_000);
    }
  });

  it("crops a tall photo rather than squashing it, and refuses one too small or not an image", async () => {
    const meta = await sharp(await kindlePhoto(await picture(600, 1400))).metadata();
    expect([meta.width, meta.height]).toEqual([KINDLE_PHOTO.width, KINDLE_PHOTO.height]);
    await expect(kindlePhoto(await picture(300, 200))).rejects.toThrow("too small");
    await expect(kindlePhoto(Buffer.from("not an image"))).rejects.toThrow();
  });
});

describe("photos on the Kindle", () => {
  it("names a Kindle copy per story, made once on request and kept beside the photo", async () => {
    t = makeApp({ pageFetcher: async (url) => pageWithPhoto(url), imageFetcher: photoFetcher(await picture(1600, 900, "webp"), "webp") });
    expect((await request(t.app).post("/admin/generate").set(ADMIN)).status).toBe(200);
    const issue = (await request(t.app).get("/api/issue/today")).body;
    const s = issue.stories[0];
    expect(s.image.path).toBe(`/issues/${TODAY}/v1/1.webp`);
    expect(s.kindle_image).toEqual({ path: `/issues/${TODAY}/v1/1.kindle.jpg` });
    const file = kindlePhotoFile(t.ctx.settings, TODAY, 1, 1);
    expect(existsSync(file)).toBe(false);
    const got = await request(t.app).get(s.kindle_image.path);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/jpeg");
    expect(existsSync(file)).toBe(true);
    expect(Buffer.from(got.body).equals(readFileSync(file))).toBe(true);
    // Under a profile mount too.
    expect((await request(t.app).get(`/p/default${s.kindle_image.path}`)).status).toBe(200);
    // Kept: asking again does not make it again.
    const made = statSync(file).mtimeMs;
    await request(t.app).get(s.kindle_image.path);
    expect(statSync(file).mtimeMs).toBe(made);
    // A newer photo (a rewrite found another) makes a new copy.
    const source = storyImageFile(t.ctx.settings, TODAY, 1, 1, "webp");
    writeFileSync(source, await picture(1200, 900, "webp"));
    utimesSync(file, new Date(made / 1000 - 60), new Date(made / 1000 - 60));
    await request(t.app).get(s.kindle_image.path);
    expect(statSync(file).mtimeMs).toBeGreaterThan(made - 60_000);
    // Not on the dashboard port.
    expect((await t.agent.get(s.kindle_image.path)).status).toBe(404);
  });

  it("puts the photo under the headline only when the Kindle asks, naming the file beside the page", async () => {
    t = makeApp({ pageFetcher: async (url) => pageWithPhoto(url), imageFetcher: photoFetcher(await picture(1600, 900), "jpeg") });
    await request(t.app).post("/admin/generate").set(ADMIN);
    const s = (await request(t.app).get("/api/issue/today")).body.stories[0];
    const plain = (await request(t.app).get(s.path)).text;
    expect(plain).not.toMatch(/<img/i);
    const page = (await request(t.app).get(`${s.path}?photo=1`)).text;
    expect(page).toContain(`<img src="${s.id}.jpg" alt="A turtle">`);
    expect(page).toMatch(/<\/h1>\s*<div class="photo">/);
    expect(page).toContain('<p class="credit">Photo: ');
    // The rest of the page is the plain page.
    expect(page.replace(/\n<div class="photo">.*<\/div>/, "").replace(/\n\/\* The Kindle's photo[\s\S]*?\.photo \.credit[^\n]*/, "")).toBe(plain);
  });

  it("has no Kindle photo for a story without one, or one that cannot be made", async () => {
    t = makeApp({ pageFetcher: async (url) => pageWithPhoto(url), imageFetcher: photoFetcher(await picture(320, 200), "jpeg") });
    await request(t.app).post("/admin/generate").set(ADMIN);
    const s = (await request(t.app).get("/api/issue/today")).body.stories[0];
    // Too small: named (the server does not know until asked), but a 404, so the Kindle shows none.
    expect((await request(t.app).get(s.kindle_image.path)).status).toBe(404);
    t.cleanup();
    t = makeApp();
    await request(t.app).post("/admin/generate").set(ADMIN);
    const bare = (await request(t.app).get("/api/issue/today")).body.stories[0];
    expect(bare.image).toBeNull();
    expect(bare.kindle_image).toBeNull();
    expect((await request(t.app).get(bare.path.replace(".html", ".kindle.jpg"))).status).toBe(404);
    expect((await request(t.app).get(`${bare.path}?photo=1`)).text).not.toMatch(/<img/i);
  });
});
