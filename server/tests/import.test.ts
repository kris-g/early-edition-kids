import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WRITER, applyImport, describe as describePlan, importTime, planImport } from "../scripts/import-comparison.js";
import { issuesDir } from "../src/config.js";
import { generate } from "../src/pipeline.js";
import { NOW, makeCtx } from "./helpers.js";

let ctx: ReturnType<typeof makeCtx> | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

const OTHER = "anthropic:claude-sonnet-5-5";
const usage = (cost: number, input = 3000, output = 900) => ({
  input_tokens: input,
  output_tokens: output,
  cost_usd: cost,
  models_answered: [WRITER],
  stop_reason: "end_turn",
});

const BODY = [
  "Scientists found something new and exciting this week. They looked very closely at old rocks.",
  "The rocks had tiny marks in them. The marks showed how animals moved a very long time ago.",
  "The team said the find will help them learn more. They want to look at more rocks soon.",
  "Other experts were pleased. They said it was a careful piece of work that many people will enjoy reading about.",
];

interface Spec {
  cid: number;
  url: string;
  title: string;
  valid?: boolean;
  supported?: boolean;
}

function result(s: Spec) {
  const valid = s.valid ?? true;
  const supported = s.supported ?? true;
  return {
    story: {
      title: `Story about ${s.title}`.slice(0, 45),
      teaser: "A short teaser line",
      topic: "Science",
      body: BODY,
      word_to_know: { word: "rocks", definition: "hard stones" },
      think_about_it: "What would you look for?",
    },
    word_count: 70,
    validation: { ok: valid, reasons: valid ? [] : ["teaser is 61 characters; the limit is 60"] },
    checker: { safe: true, supported, reasons: supported ? [] : ["invented a day"], error: null, seconds: 4, usage: usage(0.02, 2500, 300) },
    refused: false,
    error: null,
    seconds: 10,
    writer_usage: usage(0.04),
  };
}

function report(date: string, specs: Spec[]) {
  return {
    file: `reports/model-comparison-${date}.json`,
    data: {
      meta: { date, generated_at: "2026-11-13T22:00:00.000Z", candidates: 10, checker: WRITER },
      selection: { [WRITER]: { ...usage(0.019, 2500, 400), seconds: 5, picks: [], reserves: [] }, [OTHER]: { ...usage(0.006), seconds: 2 } },
      stories: specs.map((s) => ({
        candidate_id: s.cid,
        source_title: s.title,
        source_url: s.url,
        source_name: "BBC Newsround",
        topic: "Science",
        results: { [WRITER]: result(s), [OTHER]: result({ ...s, valid: true, supported: true }) },
      })),
      totals: { [WRITER]: {}, [OTHER]: {} },
    },
  };
}

describe("importing comparison reports", () => {
  it("imports only clean Opus stories, oldest day first, skipping duplicates and stories in a live issue", async () => {
    ctx = makeCtx();
    await generate(ctx, "2026-11-13", NOW); // the live Friday issue
    const live = ctx.db.storiesFor("2026-11-13", 1)[0];

    const reports = [
      // Given newest first on purpose: days are processed oldest first.
      report("2026-11-10", [
        { cid: 1, url: "https://www.bbc.co.uk/news/a?at_medium=RSS", title: "Fossil find" }, // same URL as Monday after normalising
        { cid: 2, url: "https://www.bbc.co.uk/news/b2", title: "Owls at night!" }, // same normalised title as Monday
        { cid: 3, url: "https://www.bbc.co.uk/news/c", title: "Moon base" },
        { cid: 4, url: live.source_url, title: "Anything" }, // already in Friday's live issue
      ]),
      report("2026-11-09", [
        { cid: 1, url: "https://www.bbc.co.uk/news/a", title: "Fossil find" },
        { cid: 2, url: "https://www.bbc.co.uk/news/b", title: "Owls at night" },
        { cid: 5, url: "https://www.bbc.co.uk/news/d", title: "Robot dog", supported: false }, // failed the checker
        { cid: 6, url: "https://www.bbc.co.uk/news/e", title: "Big wave", valid: false }, // failed the automatic checks
        { cid: 7, url: "https://www.bbc.co.uk/news/f", title: "Kites" },
      ]),
    ];
    const stories0 = ctx.db.queryOne("SELECT COUNT(*) AS n FROM stories")!.n;
    const plans = planImport(ctx.db, reports);
    // Planning writes nothing (the dry run).
    expect(ctx.db.queryOne("SELECT COUNT(*) AS n FROM stories")!.n).toBe(stories0);
    expect(plans.map((p) => p.date)).toEqual(["2026-11-09", "2026-11-10"]);
    const [mon, tue] = plans;
    expect(mon.stories.map((s) => [s.position, s.candidate_id])).toEqual([[1, 1], [2, 2], [3, 7]]);
    expect(mon.failed.map((f) => f.title)).toEqual(["Robot dog", "Big wave"]);
    expect(tue.stories.map((s) => s.candidate_id)).toEqual([3]);
    expect(tue.skipped.map((s) => s.reason)).toEqual([
      "duplicate: imported for 2026-11-09",
      "duplicate: imported for 2026-11-09",
      "duplicate: already in the 2026-11-13 issue",
    ]);
    const text = describePlan(plans, true);
    expect(text).toContain("DRY RUN");
    expect(text).toContain("note: fewer than 3 stories");

    applyImport(ctx, plans, reports);

    // Monday: 3 clean Opus stories in the selector's order, version 1, created at 05:31 London.
    const issue = ctx.db.getIssue("2026-11-09")!;
    expect(issue).toMatchObject({ version: 1, fallback: 0, story_count: 3, created_at: "2026-11-09T05:31:00+00:00" });
    expect(importTime("2026-11-09").toISOString()).toBe("2026-11-09T05:31:00.000Z");
    const rows = ctx.db.storiesFor("2026-11-09", 1);
    expect(rows.map((r) => r.source_url)).toEqual(["https://www.bbc.co.uk/news/a", "https://www.bbc.co.uk/news/b", "https://www.bbc.co.uk/news/f"]);
    expect(rows[0]).toMatchObject({ topic: "Science", added_by: null, reused_from: null, hidden: 0, created_at: "2026-11-09T05:31:00+00:00" });
    expect(JSON.parse(rows[0].word_to_know)).toEqual({ word: "rocks", definition: "hard stones" });
    expect(rows[0].body_html).toContain("<b>rocks</b>");
    expect(rows[0].word_count).toBeGreaterThan(60);
    expect(existsSync(path.join(issuesDir(ctx.settings), "2026-11-09", "v1", "3.html"))).toBe(true);
    expect(existsSync(path.join(issuesDir(ctx.settings), "2026-11-09", "v1", "index.json"))).toBe(true);
    expect(ctx.db.storiesFor("2026-11-10", 1).map((r) => r.source_url)).toEqual(["https://www.bbc.co.uk/news/c"]);

    // One run per day, with the Opus calls only: select + rewrites + checks (failed stories included,
    // duplicates and the other model excluded), at the run's start, with the reported costs.
    const runs = ctx.db.query("SELECT * FROM runs WHERE issue_date IN ('2026-11-09', '2026-11-10') ORDER BY issue_date");
    expect(runs.map((r) => [r.issue_date, r.status, r.started_at])).toEqual([
      ["2026-11-09", "created", "2026-11-09T05:31:00+00:00"],
      ["2026-11-10", "created", "2026-11-10T05:31:00+00:00"],
    ]);
    expect(runs[0].finished_at).toBe("2026-11-09T05:32:15+00:00"); // 5 + 5 x (10 + 4) seconds
    expect(runs[0].detail).toContain("imported from the model comparison report");
    expect(runs[0].detail).toContain("Robot dog");
    expect(runs[1].detail).toContain("already in the 2026-11-13 issue");
    const calls = ctx.db.query("SELECT * FROM llm_calls WHERE run_id = ? ORDER BY id", [runs[0].id]);
    expect(calls.map((c) => c.stage)).toEqual(["select", "rewrite", "check", "rewrite", "check", "rewrite", "check", "rewrite", "check", "rewrite", "check"]);
    expect(calls.every((c) => c.model === WRITER && c.provider === "anthropic" && c.at === "2026-11-09T05:31:00+00:00")).toBe(true);
    expect(calls.reduce((n, c) => n + c.cost_usd, 0)).toBeCloseTo(0.019 + 5 * (0.04 + 0.02));
    expect(calls.filter((c) => c.outcome === "sent_back")).toHaveLength(1);
    expect(mon.cost_usd).toBeCloseTo(0.319);
    const tueCalls = ctx.db.query("SELECT stage FROM llm_calls WHERE run_id = ?", [runs[1].id]);
    expect(tueCalls.map((c) => c.stage)).toEqual(["select", "rewrite", "check"]);

    // Running it again inserts nothing: both dates already have an issue.
    const again = planImport(ctx.db, reports);
    expect(again.every((p) => p.refused?.includes("already has an issue"))).toBe(true);
    const before = ctx.db.queryOne("SELECT (SELECT COUNT(*) FROM stories) AS s, (SELECT COUNT(*) FROM runs) AS r, (SELECT COUNT(*) FROM llm_calls) AS c")!;
    applyImport(ctx, again, reports);
    expect(ctx.db.queryOne("SELECT (SELECT COUNT(*) FROM stories) AS s, (SELECT COUNT(*) FROM runs) AS r, (SELECT COUNT(*) FROM llm_calls) AS c")).toEqual(before);
  });
});
