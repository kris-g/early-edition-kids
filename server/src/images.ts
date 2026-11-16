/**
 * Story photos for the iPad reader (CONTRACT.md "Story photos"). When a story is made, the source
 * article's main image is found (the page's og:image, then twitter:image, then the feed item's
 * media), downloaded once and stored beside the story file. Pure JS: the bytes are checked by their
 * magic numbers, never decoded, so the image stays the same on every architecture.
 *
 * A missing or failed image is never an error: the story simply has no photo.
 */

import * as cheerio from "cheerio";
import { USER_AGENT, blocklistHits, compileBlocklist } from "./feeds.js";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 20_000;
/** Alt text longer than this is cut at a word. */
const ALT_MAX = 300;

/** Accepted types and the extension each is stored with. */
export const IMAGE_TYPES: Record<string, ImageExt> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export type ImageExt = "jpg" | "png" | "webp";
export const IMAGE_EXTS: readonly ImageExt[] = ["jpg", "png", "webp"];
export const CONTENT_TYPES: Record<ImageExt, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export interface FetchedImage {
  bytes: Buffer;
  /** The response's Content-Type, without parameters. */
  contentType: string;
}

/** Injectable so tests never touch the network. Throws when the image cannot be fetched. */
export type ImageFetcher = (url: string) => Promise<FetchedImage>;

/** Where an image might be: a URL and its alt text, in order of preference. */
export interface ImageRef {
  url: string;
  alt: string | null;
}

/** A downloaded photo, ready to store. */
export interface StoryImage {
  bytes: Buffer;
  ext: ImageExt;
  alt: string | null;
  url: string;
}

/** The type the bytes really are, from their first few bytes, or null. */
export function sniffImage(bytes: Uint8Array): ImageExt | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

const mediaType = (header: string | null) => (header || "").split(";")[0].trim().toLowerCase();

/** Fetch an image over http(s), refusing anything over IMAGE_MAX_BYTES or slower than the timeout. */
export async function httpFetchImage(url: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<FetchedImage> {
  const maxBytes = opts.maxBytes ?? IMAGE_MAX_BYTES;
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`refusing to fetch non-http URL: ${url}`);
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/webp,image/jpeg,image/png;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? IMAGE_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const contentType = mediaType(resp.headers.get("content-type"));
  if (!IMAGE_TYPES[contentType]) {
    await resp.body?.cancel().catch(() => {});
    throw new Error(`not a JPEG, PNG or WebP image (${contentType || "no type"})`);
  }
  const declared = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await resp.body?.cancel().catch(() => {});
    throw new Error(`image too large (${declared} bytes)`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (resp.body) {
    const reader = resp.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`image too large (over ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function absolute(url: string, base: string | null): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The article page's main image: og:image (with og:image:alt), then twitter:image. */
export function pageImages(html: string, pageUrl: string | null): ImageRef[] {
  const $ = cheerio.load(html);
  const meta = (names: string[]) => {
    for (const n of names) {
      const v = $(`meta[property="${n}"]`).attr("content") ?? $(`meta[name="${n}"]`).attr("content");
      if (v && v.trim()) return v.trim();
    }
    return "";
  };
  const out: ImageRef[] = [];
  const og = absolute(meta(["og:image:secure_url", "og:image", "og:image:url"]), pageUrl);
  if (og) out.push({ url: og, alt: collapse(meta(["og:image:alt"])) || null });
  const tw = absolute(meta(["twitter:image", "twitter:image:src"]), pageUrl);
  if (tw && tw !== og) out.push({ url: tw, alt: collapse(meta(["twitter:image:alt"])) || null });
  return out;
}

/** Cut alt text to a sensible length at a word boundary. */
export function tidyAlt(alt: string | null | undefined): string | null {
  const s = collapse(alt ?? "");
  if (!s) return null;
  if (s.length <= ALT_MAX) return s;
  const cut = s.slice(0, ALT_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > ALT_MAX * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * Try each place in turn and keep the first image that downloads and really is a JPEG, PNG or WebP.
 * An image whose alt text contains a blocklisted word is skipped. Never throws; null means no photo.
 */
export async function downloadFirstImage(
  refs: ImageRef[],
  fetcher: ImageFetcher,
  opts: { blocklist?: readonly string[]; log?: (line: string) => void } = {},
): Promise<StoryImage | null> {
  const blocked = compileBlocklist(opts.blocklist ?? []);
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.url)) continue;
    seen.add(ref.url);
    const alt = tidyAlt(ref.alt);
    if (alt && blocklistHits(blocked, alt).length) {
      opts.log?.(`photo skipped: its description has a blocked word (${ref.url})`);
      continue;
    }
    try {
      const got = await fetcher(ref.url);
      const declared = IMAGE_TYPES[mediaType(got.contentType)];
      const real = sniffImage(got.bytes);
      if (!declared || !real || declared !== real) {
        opts.log?.(`photo skipped: not a JPEG, PNG or WebP image (${ref.url})`);
        continue;
      }
      if (got.bytes.length > IMAGE_MAX_BYTES) {
        opts.log?.(`photo skipped: too large (${ref.url})`);
        continue;
      }
      return { bytes: got.bytes, ext: real, alt, url: ref.url };
    } catch (err) {
      opts.log?.(`photo failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}
