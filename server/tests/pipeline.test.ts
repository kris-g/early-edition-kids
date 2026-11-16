import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { issuesDir } from "../src/config.js";
import { LLMUnavailable, StubLLM, type ChatMessage, type ChatOptions } from "../src/llm.js";
import { fallbackCandidates, generate, minStories, type Context } from "../src/pipeline.js";
import { addDays } from "../src/timeutil.js";
import { parseChecks } from "../src/validate.js";
import { NOW, TODAY, fixturePageFetcher, makeCtx } from "./helpers.js";

class RecordingStub extends StubLLM {
  messages: ChatMessage[][] = [];
  override async chat(messages: ChatMessage[], opts: { task: string; context?: Record<string, any> }) {
    this.messages.push(messages);
    return super.chat(messages, opts);
  }
}

/** Checker that marks stories from some source titles unsafe. */
class UnsafeFor extends StubLLM {
  constructor(private words: string[]) {
    super();
  }
  override check(ctx: Record<string, any>) {
    if (this.words.some((w) => ctx.sourceText.includes(w))) return { safe: false, supported: true, reasons: ["frightening"] };
    return super.check(ctx);
  }
}

class DownLLM extends StubLLM {
  override async chat(): Promise<string> {
    throw new LLMUnavailable("connection refused");
  }
}

/** First rewrite of every story invents a number; the retry is clean. */
class BadNumbers extends StubLLM {
  seen = new Map<number, number>();
  override rewrite(ctx: Record<string, any>) {
    const story = super.rewrite(ctx);
    const n = this.seen.get(ctx.candidate.id) ?? 0;
    this.seen.set(ctx.candidate.id, n + 1);
    if (n === 0) story.body[0] += " About 4321 people came.";
    return story;
  }
}

/** Every article page also says how many pupils and schools; the writer repeats both figures. */
const FIGURES = "More than 1,300 pupils from 40 schools took part.";
const pagesWithFigures = async (url: string) => (await fixturePageFetcher(url)).replace("</article>", `<p>${FIGURES}</p></article>`);
class WithFigures extends StubLLM {
  override rewrite(ctx: Record<string, any>) {
    const story = super.rewrite(ctx);
    story.body[0] += " In all, 1,300 pupils from 40 schools came.";
    return story;
  }
}

/** A stub that reports its calls under another model id, and can give reasons with a pass. */
class NamedStub extends StubLLM {
  constructor(private model: string, private reasons: string[] = []) {
    super();
  }
  override chat(messages: ChatMessage[], opts: ChatOptions) {
    return super.chat(messages, { ...opts, onUsage: (u) => opts.onUsage?.({ ...u, model: this.model }) });
  }
  override check() {
    return { safe: true, supported: true, reasons: this.reasons };
  }
}

const checksOf = (row: Record<string, any>) => parseChecks(row.checks);

let ctx: ReturnType<typeof makeCtx>;
afterEach(() => ctx?.cleanup());

const versionDir = (c: Context, date: string, v: number) => path.join(issuesDir(c.settings), date, `v${v}`);

async function seedIssue(c: Context, day: string, openedPositions: number[] = []) {
  await generate(c, day, NOW, true);
  const rows = c.db.storiesFor(day, Number(c.db.getIssue(day)!.version));
  for (const pos of openedPositions) {
    const sid = Number(rows[pos - 1].id);
    c.db.run(
      "INSERT INTO events (device_id, client_event_id, story_id, type, ts, received_at, payload_json) VALUES ('d', ?, ?, 'story_opened', 0, 'x', '{}')",
      [`open-${sid}`, sid],
    );
  }
  return rows;
}

describe("pipeline", () => {
  it("creates six stories", async () => {
    ctx = makeCtx();
    const result = await generate(ctx, TODAY, NOW);
    expect(result.status).toBe("created");
    expect(result.version).toBe(1);
    expect(result.fallback).toBe(false);
    expect(result.story_count).toBe(6);
    const rows = ctx.db.storiesFor(TODAY, 1);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const r of rows) {
      expect(ctx.config.topics.map((t) => t.name)).toContain(r.topic);
      expect(r.word_count).toBeGreaterThanOrEqual(100);
      expect(r.word_count).toBeLessThanOrEqual(160);
      expect(r.title.length).toBeLessThanOrEqual(45);
      expect(r.teaser.length).toBeLessThanOrEqual(60);
      expect(existsSync(path.join(versionDir(ctx, TODAY, 1), `${r.position}.html`))).toBe(true);
    }
    const index = JSON.parse(readFileSync(path.join(versionDir(ctx, TODAY, 1), "index.json"), "utf8"));
    expect(index.stories.length).toBe(6);
    expect(index.version).toBe(1);
    // A normal run: 1 select + 6 rewrites + 6 checks.
    const calls = (ctx.writer as StubLLM).calls;
    expect(calls.filter((c) => c === "select").length).toBe(1);
    expect(calls.filter((c) => c === "rewrite").length).toBe(6);
    expect(calls.filter((c) => c === "check").length).toBe(6);
  });

  it("is idempotent without force", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const again = await generate(ctx, TODAY, NOW);
    expect(again.status).toBe("exists");
    expect(again.version).toBe(1);
    expect(ctx.db.queryOne("SELECT COUNT(*) AS n FROM stories")!.n).toBe(6);
  });

  it("forces a new version and keeps the old rows", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const oldIds = ctx.db.storiesFor(TODAY, 1).map((r) => r.id);
    const result = await generate(ctx, TODAY, NOW, true);
    expect(result.status).toBe("created");
    expect(result.version).toBe(2);
    const newIds = ctx.db.storiesFor(TODAY, 2).map((r) => r.id);
    expect(newIds.length).toBe(6);
    expect(newIds.some((i) => oldIds.includes(i))).toBe(false);
    expect(oldIds.every((i) => ctx.db.getStory(i))).toBe(true);
    expect(ctx.db.getIssue(TODAY)!.version).toBe(2);
  });

  it("replaces an unsafe story with a reserve", async () => {
    ctx = makeCtx();
    ctx.checker = new UnsafeFor(["Wheelchair Rugby", "KPop"]);
    const result = await generate(ctx, TODAY, NOW);
    expect(result.story_count).toBe(6);
    const titles = ctx.db.storiesFor(TODAY, 1).map((r) => r.source_title as string);
    expect(titles.some((t) => t.includes("Wheelchair Rugby") || t.includes("KPop"))).toBe(false);
    expect(result.detail.some((l) => l.includes("not safe"))).toBe(true);
    expect(result.detail.filter((l) => l.includes("using reserve")).length).toBe(2);
  });

  it("rewrites once when a number is invented", async () => {
    ctx = makeCtx();
    ctx.writer = new BadNumbers();
    ctx.checker = ctx.writer;
    const result = await generate(ctx, TODAY, NOW);
    expect(result.story_count).toBe(6);
    expect(result.detail.some((l) => l.includes("4321"))).toBe(true);
    for (const r of ctx.db.storiesFor(TODAY, 1)) expect(r.body_html).not.toContain("4321");
  });

  it("keeps each story's checks: its numbers, the verdict, the attempts and the models", async () => {
    ctx = makeCtx();
    ctx.pageFetcher = pagesWithFigures;
    ctx.writer = new WithFigures();
    ctx.checker = new NamedStub("stub-checker", ["nothing to add"]);
    const result = await generate(ctx, TODAY, NOW);
    expect(result.story_count).toBe(6);
    for (const r of ctx.db.storiesFor(TODAY, 1)) {
      const checks = checksOf(r)!;
      // The two figures the writer used, matched in the source, after any number in the headline.
      expect(checks.numbers.slice(-2)).toEqual([
        { value: "1300", in_source: true },
        { value: "40", in_source: true },
      ]);
      expect(checks.numbers.every((n) => n.in_source)).toBe(true);
      expect(checks.verdict).toEqual({ safe: true, supported: true, reasons: ["nothing to add"] });
      expect(checks.attempts).toBe(1);
      expect(checks.writer_model).toBe("stub");
      expect(checks.checker_model).toBe("stub-checker");
    }
  });

  it("stores the second attempt's checks when the first was sent back", async () => {
    ctx = makeCtx();
    ctx.writer = new BadNumbers();
    ctx.checker = ctx.writer;
    await generate(ctx, TODAY, NOW);
    for (const r of ctx.db.storiesFor(TODAY, 1)) {
      const checks = checksOf(r)!;
      expect(checks.attempts).toBe(2);
      expect(checks.numbers.map((n) => n.value)).not.toContain("4321");
      expect(checks.verdict).toEqual({ safe: true, supported: true, reasons: [] });
    }
  });

  it("takes a reserve when the article is too short", async () => {
    ctx = makeCtx();
    ctx.pageFetcher = async (url) =>
      url.includes("newsround") ? "<article><p>Only a few words on this page today.</p></article>" : fixturePageFetcher(url);
    const result = await generate(ctx, TODAY, NOW);
    expect(result.status).toBe("created");
    for (const r of ctx.db.storiesFor(TODAY, 1)) expect(r.source_url).not.toContain("newsround");
  });

  it("sends no personal data in prompts", async () => {
    ctx = makeCtx();
    const rec = new RecordingStub();
    ctx.writer = rec;
    ctx.checker = rec;
    ctx.db.run(
      "INSERT INTO events (device_id, client_event_id, type, ts, received_at, payload_json) VALUES ('device-secret-123', 'e1', 'list_shown', 0, 'x', '{}')",
    );
    await generate(ctx, TODAY, NOW);
    const text = JSON.stringify(rec.messages);
    expect(text).not.toContain("device-secret-123");
    expect(text).toContain("8 year old");
    expect(text).toContain("Football");
    expect(text).toContain("Harry Kane");
  });

  it("publishes a catch-up issue from unopened stories when the LLM is down", async () => {
    ctx = makeCtx();
    const yesterday = addDays(TODAY, -1);
    const rows = await seedIssue(ctx, yesterday, [1, 2]);
    ctx.writer = new DownLLM();
    ctx.checker = ctx.writer;
    const result = await generate(ctx, TODAY, NOW);
    expect(result.status).toBe("created");
    expect(result.fallback).toBe(true);
    expect(result.story_count).toBe(4);
    const copies = ctx.db.storiesFor(TODAY, 1);
    expect(copies.map((c) => c.reused_from)).toEqual(rows.slice(2).map((r) => r.id));
    expect(copies.some((c) => [rows[0].id, rows[1].id].includes(c.reused_from))).toBe(false);
    expect(copies.some((c) => rows.map((r) => r.id).includes(c.id))).toBe(false);
    expect(ctx.db.getIssue(TODAY)!.fallback).toBe(1);
    expect(existsSync(path.join(versionDir(ctx, TODAY, 1), "1.html"))).toBe(true);
    // A catch-up story is the same text, so it carries the checks of the story it copies.
    expect(copies.every((c) => typeof c.checks === "string")).toBe(true);
    expect(copies.map((c) => c.checks)).toEqual(rows.slice(2).map((r) => r.checks));
  });

  it("publishes nothing with fewer than three unopened stories", async () => {
    ctx = makeCtx();
    await seedIssue(ctx, addDays(TODAY, -1), [1, 2, 3, 4]);
    ctx.writer = new DownLLM();
    ctx.checker = ctx.writer;
    const result = await generate(ctx, TODAY, NOW);
    expect(result.status).toBe("failed");
    expect(result.version).toBeNull();
    expect(ctx.db.getIssue(TODAY)).toBeUndefined();
  });

  it("publishes a paper of one or two stories when story_count asks for that few", async () => {
    expect(minStories(6)).toBe(3);
    expect(minStories(3)).toBe(3);
    expect(minStories(2)).toBe(2);
    expect(minStories(1)).toBe(1);
    for (const n of [1, 2]) {
      ctx = makeCtx();
      ctx.config = { ...ctx.config, storyCount: n };
      const result = await generate(ctx, TODAY, NOW);
      expect(result.status).toBe("created");
      expect(result.fallback).toBe(false);
      expect(result.story_count).toBe(n);
      ctx.cleanup();
    }
  });

  it("publishes a two-story catch-up issue when story_count is 2", async () => {
    ctx = makeCtx();
    await seedIssue(ctx, addDays(TODAY, -1), [1, 2, 3, 4]);
    ctx.config = { ...ctx.config, storyCount: 2 };
    ctx.writer = new DownLLM();
    ctx.checker = ctx.writer;
    const result = await generate(ctx, TODAY, NOW);
    expect(result.status).toBe("created");
    expect(result.fallback).toBe(true);
    expect(result.story_count).toBe(2);
  });

  it("ignores hidden, old and opened stories for catch-up", async () => {
    ctx = makeCtx();
    await seedIssue(ctx, addDays(TODAY, -8));
    expect(fallbackCandidates(ctx.db, TODAY, 7, 6)).toEqual([]);
    const rows = await seedIssue(ctx, addDays(TODAY, -1));
    ctx.db.setHidden(Number(rows[0].id), true);
    const picks = fallbackCandidates(ctx.db, TODAY, 7, 6);
    expect(picks.map((p) => p.id)).not.toContain(rows[0].id);
    expect(picks.length).toBe(5);
  });

  it("keeps the existing issue when a forced run fails", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    ctx.writer = new DownLLM();
    ctx.checker = ctx.writer;
    const result = await generate(ctx, TODAY, NOW, true);
    expect(result.status).toBe("failed");
    expect(result.version).toBe(1);
    expect(ctx.db.getIssue(TODAY)!.version).toBe(1);
  });

  it("does not repeat recent stories", async () => {
    ctx = makeCtx();
    const first = new Set((await seedIssue(ctx, addDays(TODAY, -1))).map((r) => r.source_url));
    await generate(ctx, TODAY, NOW);
    const today = ctx.db.storiesFor(TODAY, 1).map((r) => r.source_url);
    expect(today.some((u) => first.has(u))).toBe(false);
  });

  it("serialises concurrent runs for the same date", async () => {
    ctx = makeCtx();
    const [a, b] = await Promise.all([generate(ctx, TODAY, NOW), generate(ctx, TODAY, NOW)]);
    expect([a.status, b.status].sort()).toEqual(["created", "exists"]);
    expect(ctx.db.queryOne("SELECT COUNT(*) AS n FROM stories")!.n).toBe(6);
  });
});
