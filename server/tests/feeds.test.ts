import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import {
  blocklistHits,
  compileBlocklist,
  extractArticle,
  fetchAll,
  filterCandidates,
  newReport,
  normaliseTitle,
  normaliseUrl,
  parseFeed,
  textFromContentHtml,
  type Candidate,
} from "../src/feeds.js";
import { FIXTURES, NOW, exampleConfig, exampleConfigData, fakeArticleHtml, fixtureFeedFetcher } from "./helpers.js";

const config = exampleConfig();
const items = () => fetchAll(config.feeds, fixtureFeedFetcher, []);
const feed = (name: string) => config.feeds.find((f) => f.name === name)!;
const fixture = (f: string) => readFileSync(path.join(FIXTURES, f));

describe("feeds", () => {
  it("parses each fixture", () => {
    const nr = parseFeed(fixture("newsround.xml"), feed("BBC Newsround"));
    const sne = parseFeed(fixture("snexplores.xml"), feed("Science News Explores"));
    const fb = parseFeed(fixture("bbcfootball.xml"), feed("BBC Sport football"));
    const sci = parseFeed(fixture("bbcscience.xml"), feed("BBC science"));
    expect([nr.length, sne.length, fb.length, sci.length]).toEqual([80, 20, 81, 41]);
    expect([...nr, ...sne, ...fb, ...sci].every((i) => i.published !== null)).toBe(true);
    // Science News Explores carries full text; the BBC feeds do not.
    expect(sne.every((i) => i.contentHtml)).toBe(true);
    expect([...nr, ...fb, ...sci].some((i) => i.contentHtml)).toBe(false);
    expect(nr[3].url).not.toContain("&amp;");
    expect(nr[3].title.startsWith("Microsoft outage")).toBe(true);
    expect(sne[0].title).toBe("How brain-eating amoebas may wriggle into someone’s brain");
    expect(sne[0].summary.startsWith("Naegleria amoebas are dogged explorers")).toBe(true);
  });

  it("keeps recent real articles only", async () => {
    const report = newReport();
    const cands = filterCandidates(await items(), { now: NOW, config, report });
    const titles = cands.map((c) => c.title);
    const urls = cands.map((c) => c.url);
    // 48-hour window on the item's own date: old explainers resurfacing in the feed are dropped.
    expect(cands.every((c) => c.published.getTime() >= NOW.getTime() - 48 * 3600_000)).toBe(true);
    expect(titles.some((t) => t.includes("World War One") || t.includes("D-Day"))).toBe(false);
    // Non-articles.
    expect(urls.some((u) => u.includes("/videos/") || u.includes("watch_newsround") || u.includes("/sounds/"))).toBe(false);
    expect(titles.some((t) => t.startsWith("Quiz") || t.startsWith("Watch Newsround"))).toBe(false);
    expect(titles).not.toContain("What does kindness mean to you?"); // a "have your say" prompt
    expect(titles.some((t) => t.toLowerCase().includes("gossip"))).toBe(false);
    // Blocklist on title or summary.
    expect(titles.some((t) => t.toLowerCase().includes("sack"))).toBe(false);
    expect(titles.some((t) => t.includes("brain-eating"))).toBe(false);
    // Real articles survive.
    expect(titles).toContain("Harry Kane becomes England's most-capped male player");
    expect(titles).toContain("Ocean cold snaps can imperil sea turtles. Rescuers can help");
    // Duplicates within the run are dropped and ids are sequential.
    expect(new Set(urls).size).toBe(urls.length);
    expect(cands.map((c) => c.id)).toEqual(cands.map((_, i) => i + 1));
    expect(report.duplicate > 0 && report.excluded > 0 && report.blocked > 0 && report.too_old > 0).toBe(true);
    expect(report.kept).toBe(37);
  });

  it("strips tracking params and merges duplicates", async () => {
    const cands = filterCandidates(await items(), { now: NOW, config });
    expect(cands.some((c) => c.url.includes("at_medium"))).toBe(false);
    const ms = cands.filter((c) => c.title.startsWith("Microsoft outage"));
    expect(ms.length).toBe(1);
    expect(ms[0].url).toBe("https://www.bbc.co.uk/newsround/articles/cqjd75rmv9zeo");
  });

  it("de-duplicates against recent stories", async () => {
    const all = await items();
    const first = filterCandidates(all, { now: NOW, config });
    const kane = first.find((c) => c.title.startsWith("Harry Kane becomes"))!;
    const turtles = first.find((c) => c.title.startsWith("Ocean cold snaps"))!;
    const again = filterCandidates(all, {
      now: NOW,
      config,
      recentUrls: new Set([kane.url]),
      recentTitles: new Set([normaliseTitle("OCEAN cold snaps can imperil sea turtles - rescuers can help!")]),
    });
    const titles = again.map((c) => c.title);
    expect(titles).not.toContain(kane.title);
    expect(titles).not.toContain(turtles.title);
    expect(again.length).toBe(first.length - 2);
  });

  it("normalises URLs and titles", () => {
    expect(normaliseUrl("https://www.bbc.co.uk/x/a1?at_medium=RSS&at_campaign=rss#0")).toBe("https://www.bbc.co.uk/x/a1");
    expect(normaliseUrl("https://example.org/a/?id=3&utm_source=x")).toBe("https://example.org/a?id=3");
    expect(normaliseTitle("  Why is it suddenly so COLD?  ")).toBe("why is it suddenly so cold");
    expect(normaliseTitle("Ocean’s edge")).toBe(normaliseTitle("Ocean's edge"));
  });

  it("matches blocklist whole words only", () => {
    const p = compileBlocklist(["war", "drone strike", "kill"]);
    expect(blocklistHits(p, "A war began").length).toBe(1);
    expect(blocklistHits(p, "after a DRONE  strike").length).toBe(1);
    expect(blocklistHits(p, "Star Wars fans and skilled warriors").length).toBe(0);
    expect(blocklistHits(p, "a great skill").length).toBe(0);
  });

  it("extracts feed content first, then the page", async () => {
    const sne = parseFeed(fixture("snexplores.xml"), feed("Science News Explores"));
    const turtles = sne.find((i) => i.title.includes("sea turtles"))!;
    const text = textFromContentHtml(turtles.contentHtml!);
    expect(text.split(/\s+/).length).toBeGreaterThan(150);
    expect(text).not.toContain("<p");

    const fetched: string[] = [];
    const page = async (url: string) => {
      fetched.push(url);
      return fakeArticleHtml(url);
    };
    const cand: Candidate = {
      id: 1, title: turtles.title, summary: "", url: turtles.url, sourceName: "SNE", kidsSource: true,
      topicHint: "Science", published: NOW, contentHtml: turtles.contentHtml,
    };
    const out = await extractArticle(cand, page, 6000);
    expect(fetched).toEqual([]);
    expect(out.length).toBeLessThanOrEqual(6000);

    const bbc: Candidate = { ...cand, url: "https://www.bbc.co.uk/news/articles/abc", contentHtml: null };
    const out2 = await extractArticle(bbc, page, 6000);
    expect(fetched).toEqual(["https://www.bbc.co.uk/news/articles/abc"]);
    expect(out2).not.toContain("Home News Sport"); // nav text is not article text
    expect(out2.split(/\s+/).length).toBeGreaterThanOrEqual(150);
  });

  it("does not crash on a bad exclude pattern", () => {
    const data = exampleConfigData();
    data.feeds[0].exclude_title_patterns = ["(unclosed"];
    expect(filterCandidates([], { now: NOW, config: parseConfig(data) })).toEqual([]);
  });

  it("accepts a null or missing topic_hint", () => {
    const data = exampleConfigData();
    data.feeds[0].topic_hint = null;
    delete data.feeds[1].topic_hint;
    const cfg = parseConfig(data);
    expect(cfg.feeds[0].topicHint).toBeNull();
    expect(cfg.feeds[1].topicHint).toBeNull();
  });
});
