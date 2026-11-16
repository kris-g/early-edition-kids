/** Feed fetching, parsing and the candidate filter (DESIGN 4.1 steps 1-2, 4.5), and article extraction. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { APP_NAME, VERSION, type Config, type Feed } from "./config.js";
import type { ImageRef } from "./images.js";

export const USER_AGENT = `${APP_NAME}/${VERSION} (household news reader)`;

/** Fetchers are injectable so tests never touch the network. */
export type FeedFetcher = (url: string) => Promise<Buffer | string>;
export type PageFetcher = (url: string) => Promise<string>;

export interface Candidate {
  id: number;
  title: string;
  summary: string;
  url: string;
  sourceName: string;
  kidsSource: boolean;
  topicHint: string | null;
  published: Date;
  contentHtml: string | null;
  /** The feed item's own image (media:content, media:thumbnail or an image enclosure), if any. */
  feedImage?: ImageRef | null;
}

export function promptCandidate(c: Candidate) {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    source: c.sourceName,
    kids_source: c.kidsSource,
    topic_hint: c.topicHint || "none",
  };
}

// ---- fetching ----

export async function httpFetchBytes(url: string, timeoutMs = 20000): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`refusing to fetch non-http URL: ${url}`);
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Fetch a configured feed. `file://` URLs are allowed here (owner-controlled config). */
export async function httpFetchFeed(url: string): Promise<Buffer> {
  if (url.startsWith("file://")) return readFile(fileURLToPath(url));
  return httpFetchBytes(url);
}

export async function httpFetchText(url: string): Promise<string> {
  return (await httpFetchBytes(url)).toString("utf8");
}

// ---- normalisation ----

const TRACKING = /^(at_|utm_|ocid$|fbclid$|gclid$)/i;

/** Drop tracking parameters and fragments so the same article compares equal. */
export function normaliseUrl(url: string): string {
  const raw = (url || "").trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const params = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (!TRACKING.test(k)) params.append(k, v);
  let pathname = u.pathname.replace(/\/+$/, "") || u.pathname;
  const query = params.toString();
  return `${u.protocol}//${u.host}${pathname}${query ? `?${query}` : ""}`;
}

export function normaliseTitle(title: string): string {
  return (title || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  $("br, p, div, li, h1, h2, h3, h4, tr").each((_, el) => {
    $(el).append(" ");
  });
  return collapse($("#__root").text());
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive matcher for blocklist words and phrases. */
export function compileBlocklist(words: readonly string[]): RegExp | null {
  const alts = words
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => escapeRegex(w).replace(/\s+/g, "\\s+"))
    .sort((a, b) => b.length - a.length);
  if (alts.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}_])(${alts.join("|")})(?![\\p{L}\\p{N}_])`, "giu");
}

export function blocklistHits(pattern: RegExp | null, text: string): string[] {
  if (!pattern) return [];
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((m) => m[0]);
}

// ---- parsing ----

export interface FeedItem {
  title: string;
  summary: string;
  url: string;
  published: Date | null;
  contentHtml: string | null;
  feed: Feed;
  /** The item's own image, if the feed gives one. */
  image?: ImageRef | null;
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (name) => ["item", "entry", "link", "content:encoded"].includes(name),
});

function textOf(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === "object") return textOf((v as any)["#text"]);
  return "";
}

function parseDate(v: unknown): Date | null {
  const s = textOf(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function linkOf(v: unknown): string {
  if (Array.isArray(v)) {
    const alt = v.find((l) => typeof l === "object" && l && (!l["@_rel"] || l["@_rel"] === "alternate")) ?? v[0];
    return linkOf(alt);
  }
  if (v && typeof v === "object") return String((v as any)["@_href"] ?? (v as any)["#text"] ?? "");
  return textOf(v);
}

const asList = (v: unknown): any[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function feedUrl(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const isImageMedia = (m: any) => {
  const type = String(m?.["@_type"] ?? "").toLowerCase();
  const medium = String(m?.["@_medium"] ?? "").toLowerCase();
  if (type) return type.startsWith("image/");
  return medium ? medium === "image" : /\.(jpe?g|png|webp)(\?|$)/i.test(String(m?.["@_url"] ?? ""));
};

/**
 * The item's own image: the widest media:content image (also inside media:group), else the widest
 * media:thumbnail, else an image enclosure. Alt text from media:description or media:title.
 */
export function feedItemImage(it: any): ImageRef | null {
  const widest = (list: any[]) =>
    list
      .filter((m) => feedUrl(m?.["@_url"]))
      .sort((a, b) => (Number(b?.["@_width"]) || 0) - (Number(a?.["@_width"]) || 0))[0];
  const contents = [...asList(it["media:content"]), ...asList(it["media:group"]).flatMap((g) => asList(g?.["media:content"]))].filter(isImageMedia);
  const thumbs = [...asList(it["media:thumbnail"]), ...asList(it["media:group"]).flatMap((g) => asList(g?.["media:thumbnail"]))];
  const enclosures = [
    ...asList(it.enclosure),
    ...asList(it.link).filter((l) => l && typeof l === "object" && l["@_rel"] === "enclosure").map((l) => ({ "@_url": l["@_href"], "@_type": l["@_type"] })),
  ].filter((e) => String(e?.["@_type"] ?? "").toLowerCase().startsWith("image/"));
  const pick = widest(contents) ?? widest(thumbs) ?? widest(enclosures);
  if (!pick) return null;
  const alt = htmlToText(textOf(pick["media:description"] ?? pick["media:title"] ?? it["media:description"]));
  return { url: feedUrl(pick["@_url"])!, alt: alt || null };
}

export function parseFeed(data: Buffer | string, feed: Feed): FeedItem[] {
  const doc = xml.parse(typeof data === "string" ? data : data.toString("utf8"));
  const items: FeedItem[] = [];
  const rssItems: any[] = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? [];
  const atomEntries: any[] = doc?.feed?.entry ?? [];
  for (const it of rssItems) {
    const title = htmlToText(textOf(it.title));
    const url = linkOf(it.link).trim();
    if (!title || !url) continue;
    const contents = (it["content:encoded"] ?? []).map(textOf).filter(Boolean) as string[];
    const contentHtml = contents.sort((a, b) => b.length - a.length)[0] ?? null;
    items.push({
      title,
      summary: htmlToText(textOf(it.description)),
      url,
      published: parseDate(it.pubDate ?? it["dc:date"]),
      contentHtml,
      feed,
      image: feedItemImage(it),
    });
  }
  for (const e of atomEntries) {
    const title = htmlToText(textOf(e.title));
    const url = linkOf(e.link).trim();
    if (!title || !url) continue;
    const content = textOf(e.content);
    items.push({
      title,
      summary: htmlToText(textOf(e.summary)),
      url,
      published: parseDate(e.published ?? e.updated),
      contentHtml: content || null,
      feed,
      image: feedItemImage(e),
    });
  }
  return items;
}

// ---- filtering ----

export interface FilterReport {
  kept: number;
  too_old: number;
  duplicate: number;
  excluded: number;
  blocked: number;
  recently_used: number;
}

export const newReport = (): FilterReport => ({ kept: 0, too_old: 0, duplicate: 0, excluded: 0, blocked: 0, recently_used: 0 });

export const reportSummary = (r: FilterReport) =>
  `candidates kept=${r.kept} too_old=${r.too_old} duplicate=${r.duplicate} excluded=${r.excluded} blocked=${r.blocked} recently_used=${r.recently_used}`;

export function matchesAny(patterns: readonly string[], text: string): boolean {
  for (const p of patterns) {
    try {
      if (new RegExp(p, "i").test(text)) return true;
    } catch {
      // A bad pattern in the ConfigMap should not stop the run; treat it literally.
      if (text.toLowerCase().includes(p.toLowerCase())) return true;
    }
  }
  return false;
}

export function isExcluded(item: { url: string; title: string; feed: Feed }): boolean {
  return matchesAny(item.feed.excludeUrlPatterns, item.url) || matchesAny(item.feed.excludeTitlePatterns, item.title);
}

/** Apply DESIGN 4.1 step 2 and return numbered candidates. */
export function filterCandidates(
  items: Iterable<FeedItem>,
  opts: {
    now: Date;
    config: Config;
    recentUrls?: Set<string>;
    recentTitles?: Set<string>;
    skipUrls?: Set<string>;
    report?: FilterReport;
  },
): Candidate[] {
  const { now, config } = opts;
  const report = opts.report ?? newReport();
  const recentUrls = opts.recentUrls ?? new Set();
  const recentTitles = opts.recentTitles ?? new Set();
  const skipUrls = opts.skipUrls ?? new Set();
  const blocklist = compileBlocklist(config.blocklist);
  const oldest = now.getTime() - config.maxAgeHours * 3600_000;
  const newest = now.getTime() + 2 * 3600_000; // tolerate small clock skew in feeds

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const out: Candidate[] = [];
  for (const item of items) {
    const t = item.published?.getTime();
    if (t === undefined || t < oldest || t > newest) {
      report.too_old++;
      continue;
    }
    const url = normaliseUrl(item.url);
    const ntitle = normaliseTitle(item.title);
    if (seenUrls.has(url) || seenTitles.has(ntitle)) {
      report.duplicate++;
      continue;
    }
    if (isExcluded(item)) {
      report.excluded++;
      continue;
    }
    if (blocklistHits(blocklist, item.title).length || blocklistHits(blocklist, item.summary).length) {
      report.blocked++;
      continue;
    }
    if (recentUrls.has(url) || recentTitles.has(ntitle) || skipUrls.has(url)) {
      report.recently_used++;
      continue;
    }
    seenUrls.add(url);
    seenTitles.add(ntitle);
    out.push({
      id: out.length + 1,
      title: item.title,
      summary: item.summary,
      url,
      sourceName: item.feed.name,
      kidsSource: item.feed.kidsSource,
      topicHint: item.feed.topicHint,
      published: item.published!,
      contentHtml: item.contentHtml,
      feedImage: item.image ?? null,
    });
  }
  report.kept = out.length;
  return out;
}

export async function fetchAll(feeds: readonly Feed[], fetcher: FeedFetcher, log: string[]): Promise<FeedItem[]> {
  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const parsed = parseFeed(await fetcher(feed.url), feed);
        return { feed, parsed };
      } catch (err) {
        return { feed, error: err };
      }
    }),
  );
  const items: FeedItem[] = [];
  for (const r of results) {
    if ("error" in r) {
      log.push(`feed '${r.feed.name}' failed: ${String(r.error)}`);
    } else {
      log.push(`feed '${r.feed.name}': ${r.parsed.length} items`);
      items.push(...r.parsed);
    }
  }
  return items;
}

// ---- article text extraction (DESIGN 4.1 step 4) ----

const countWordsLoose = (s: string) => s.split(/\s+/).filter(Boolean).length;

function paragraphText($: cheerio.CheerioAPI, node: any): string {
  const paras: string[] = [];
  $(node)
    .find("p")
    .each((_, p) => {
      const $p = $(p);
      if ($p.closest("a").length) return; // promo cards: a headline wrapped in a link
      const text = collapse($p.text());
      let linkText = 0;
      $p.find("a").each((_, a) => {
        linkText += $(a).text().trim().length;
      });
      if (text && linkText / text.length > 0.5) return; // "related stories" and "follow us" lines
      if (countWordsLoose(text) >= 4) paras.push(text);
    });
  return paras.join("\n\n");
}

export function textFromContentHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, figure, figcaption, iframe").remove();
  return paragraphText($, $.root()) || htmlToText(html);
}

export function textFromPageHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, aside, figure, figcaption, form").remove();
  // BBC article pages mark real body text as text blocks; related links and promos are other blocks.
  const blocks = $('[data-component="text-block"]');
  if (blocks.length) {
    const text = blocks
      .toArray()
      .map((b) => paragraphText($, b))
      .filter(Boolean)
      .join("\n\n");
    if (text) return text;
  }
  for (const selector of ["article", "main", '[role="main"]']) {
    const node = $(selector).first();
    if (node.length) {
      const text = paragraphText($, node);
      if (text) return text;
    }
  }
  return paragraphText($, $.root());
}

/** Title and description from a page's metadata, for a pasted URL. */
export function pageMeta(html: string): { title: string; summary: string; siteName: string } {
  const $ = cheerio.load(html);
  const meta = (sel: string) => collapse($(sel).attr("content") ?? "");
  const title = meta('meta[property="og:title"]') || collapse($("h1").first().text()) || collapse($("title").first().text());
  const summary = meta('meta[property="og:description"]') || meta('meta[name="description"]');
  const siteName = meta('meta[property="og:site_name"]');
  return { title, summary, siteName };
}

export function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (end > limit * 0.6 ? cut.slice(0, end + 1) : cut).trim();
}

/** The article text: feed full content if present, else the fetched page. */
export async function extractArticle(
  c: Pick<Candidate, "url" | "contentHtml">,
  pageFetcher: PageFetcher,
  charLimit: number,
): Promise<string> {
  return (await extractArticlePage(c, pageFetcher, charLimit)).text;
}

/** As extractArticle, also returning the page HTML when it was fetched (null when the feed had enough). */
export async function extractArticlePage(
  c: Pick<Candidate, "url" | "contentHtml">,
  pageFetcher: PageFetcher,
  charLimit: number,
): Promise<{ text: string; pageHtml: string | null }> {
  let text = "";
  let pageHtml: string | null = null;
  if (c.contentHtml) text = textFromContentHtml(c.contentHtml);
  if (countWordsLoose(text) < 150) {
    pageHtml = await pageFetcher(c.url);
    const pageText = textFromPageHtml(pageHtml);
    if (pageText.length > text.length) text = pageText;
  }
  return { text: truncateText(text, charLimit), pageHtml };
}
