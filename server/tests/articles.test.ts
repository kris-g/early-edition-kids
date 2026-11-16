import { afterEach, describe, expect, it } from "vitest";
import { addArticle, searchArchive } from "../src/articles.js";
import { utcnowIso } from "../src/db.js";
import { StubLLM } from "../src/llm.js";
import { archiveItems, generate } from "../src/pipeline.js";
import { parseChecks } from "../src/validate.js";
import { NOW, TODAY, makeCtx } from "./helpers.js";

let ctx: ReturnType<typeof makeCtx>;
afterEach(() => ctx?.cleanup());

const TOMORROW = "2026-11-15";
const tomorrowNow = new Date(NOW.getTime() + 86400_000);

describe("archive", () => {
  it("keeps every fetched article, picked or not, but not videos, podcasts or quizzes", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const n = Number(ctx.db.queryOne("SELECT COUNT(*) AS n FROM articles")!.n);
    // 222 items in the fixtures, minus repeats of the same URL.
    expect(n).toBeGreaterThan(100);
    expect(n).toBeLessThanOrEqual(222);
    const quiz = ctx.db.queryOne("SELECT * FROM articles WHERE title LIKE 'Quiz of the Week%'");
    expect(quiz).toBeFalsy(); // a non-article: excluded from selection and from search
    const videos = ctx.db.queryOne("SELECT COUNT(*) AS n FROM articles WHERE url LIKE '%/videos/%' OR url LIKE '%/sounds/%'")!;
    expect(videos.n).toBe(0);
    const any = ctx.db.queryOne("SELECT * FROM articles LIMIT 1");
    expect(Object.keys(any!).sort()).toEqual(["fetched_at", "published_at", "source_name", "summary", "title", "url"]);
  });

  it("drops items not seen for 30 days", () => {
    ctx = makeCtx();
    const feed = ctx.config.feeds[0];
    const item = { title: "Old", summary: "", url: "https://e.test/old", published: null, contentHtml: null, feed };
    archiveItems(ctx.db, [item], new Date(NOW.getTime() - 31 * 86400_000));
    expect(ctx.db.queryOne("SELECT COUNT(*) AS n FROM articles")!.n).toBe(1);
    archiveItems(ctx.db, [{ ...item, url: "https://e.test/new", title: "New" }], NOW);
    expect(ctx.db.query("SELECT url FROM articles").map((r) => r.url)).toEqual(["https://e.test/new"]);
  });

  it("searches by keyword with FTS5, and with LIKE as a fallback", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    expect(ctx.db.ftsEnabled).toBe(true);
    const fts = searchArchive(ctx, "turtles rescuers");
    expect(fts.map((h) => h.title)).toContain("Ocean cold snaps can imperil sea turtles. Rescuers can help");
    const prefix = searchArchive(ctx, "capyb"); // prefix match
    expect(prefix.length).toBeGreaterThan(0);
    // Newest first.
    const all = searchArchive(ctx, "");
    const dates = all.map((h) => h.published_at ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
    ctx.db.ftsEnabled = false;
    const like = searchArchive(ctx, "turtles rescuers");
    expect(like.map((h) => h.url)).toEqual(fts.map((h) => h.url));
    expect(searchArchive(ctx, "qqzz%_")).toEqual([]); // wildcards are escaped
  });
});

describe("adding articles", () => {
  it("adds to today in the same version at the next position", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const hit = searchArchive(ctx, "penguin")[0];
    const r = await addArticle(ctx, { url: hit.url, when: "today", now: NOW });
    expect(r.ok).toBe(true);
    const row = ctx.db.getStory(r.storyId!)!;
    expect(row.issue_version).toBe(1);
    expect(row.position).toBe(7);
    expect(row.added_by).toBe("parent");
    // A parent-added story goes through the same checks, and keeps what they found.
    expect(parseChecks(row.checks)).toMatchObject({ verdict: { safe: true, supported: true }, attempts: 1, writer_model: "stub" });
    expect(ctx.db.getIssue(TODAY)!.story_count).toBe(7);
    const again = await addArticle(ctx, { url: hit.url, when: "today", now: NOW });
    expect(again.ok).toBe(false);
    expect(again.message).toContain("already in today's issue");
  });

  it("refuses today before today's issue exists", async () => {
    ctx = makeCtx();
    const r = await addArticle(ctx, { url: "https://e.test/a", when: "today", now: NOW });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("has not been made yet");
  });

  it("never bypasses the checks: an unsafe story is not added", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    ctx.checker = new (class extends StubLLM {
      override check() {
        return { safe: false, supported: true, reasons: ["about an injury"] };
      }
    })();
    const r = await addArticle(ctx, { url: searchArchive(ctx, "penguin")[0].url, when: "today", now: NOW });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("about an injury");
    expect(ctx.db.storiesFor(TODAY, 1).length).toBe(6);
  });

  it("rejects a story with an invented number after one retry", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    ctx.writer = new (class extends StubLLM {
      override rewrite(c: Record<string, any>) {
        const s = super.rewrite(c);
        s.body[0] += " It cost 999 pounds.";
        return s;
      }
    })();
    const r = await addArticle(ctx, { url: searchArchive(ctx, "penguin")[0].url, when: "today", now: NOW });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("999");
    expect(ctx.db.storiesFor(TODAY, 1).length).toBe(6);
  });

  it("adds a pasted URL from any site", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const r = await addArticle(ctx, { url: "https://example.test/news/robot-dog?utm_source=x", when: "today", now: NOW });
    expect(r.ok).toBe(true);
    const row = ctx.db.getStory(r.storyId!)!;
    expect(row.source_url).toBe("https://example.test/news/robot-dog");
    expect(row.source_name).toBe("Example News");
    expect(row.source_title).toBe("Pretend page about robot dog");
  });

  it("saves a request for tomorrow that the next generation uses as a pick", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const hit = searchArchive(ctx, "capybaras")[0] ?? searchArchive(ctx, "")[40];
    const r = await addArticle(ctx, { url: hit.url, when: "tomorrow", now: NOW });
    expect(r.ok).toBe(true);
    const req = ctx.db.queryOne("SELECT * FROM add_requests WHERE id = ?", [r.requestId!])!;
    expect(req.for_date).toBe(TOMORROW);
    expect(req.status).toBe("pending");
    // A forced regenerate of today does not use tomorrow's request.
    await generate(ctx, TODAY, NOW, true);
    expect(ctx.db.queryOne("SELECT status FROM add_requests WHERE id = ?", [r.requestId!])!.status).toBe("pending");

    const result = await generate(ctx, TOMORROW, tomorrowNow);
    expect(result.status).toBe("created");
    expect(result.story_count).toBe(6);
    const rows = ctx.db.storiesFor(TOMORROW, 1);
    const added = rows.filter((s) => s.source_url === hit.url);
    expect(added.length).toBe(1); // included once, not also picked by selection
    expect(added[0].added_by).toBe("parent");
    const done = ctx.db.queryOne("SELECT * FROM add_requests WHERE id = ?", [r.requestId!])!;
    expect(done.status).toBe("added");
    expect(done.story_id).toBe(added[0].id);
  });

  it("marks a tomorrow request failed with reasons when it fails the checks, and fills the slot", async () => {
    ctx = makeCtx();
    const url = "https://example.test/news/scary-thing";
    const r = await addArticle(ctx, { url, when: "tomorrow", now: NOW });
    expect(r.ok).toBe(true);
    ctx.checker = new (class extends StubLLM {
      override check(c: Record<string, any>) {
        return c.candidate?.url === url ? { safe: false, supported: true, reasons: ["frightening"] } : super.check(c);
      }
    })();
    const result = await generate(ctx, TOMORROW, tomorrowNow);
    expect(result.story_count).toBe(6);
    const req = ctx.db.queryOne("SELECT * FROM add_requests WHERE id = ?", [r.requestId!])!;
    expect(req.status).toBe("failed");
    expect(req.detail).toContain("frightening");
    expect(ctx.db.storiesFor(TOMORROW, 1).some((s) => s.source_url === url)).toBe(false);
  });

  it("refuses a tomorrow request when the article cannot be read", async () => {
    ctx = makeCtx();
    ctx.pageFetcher = async () => "<html><head><title>t</title></head><body><p>Too short to use.</p></body></html>";
    const r = await addArticle(ctx, { url: "https://example.test/short", when: "tomorrow", now: NOW });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("words of article text");
    expect(ctx.db.queryOne("SELECT COUNT(*) AS n FROM add_requests")!.n).toBe(0);
    expect(utcnowIso(NOW)).toBe("2026-11-14T05:30:00+00:00");
  });
});
