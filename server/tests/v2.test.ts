import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { effectiveAiSettings, updateAiSettings } from "../src/aisettings.js";
import { addArticle } from "../src/articles.js";
import { makeSettings, parseConfig } from "../src/config.js";
import { calendarView, readingView, runCost, streakFrom } from "../src/dashboard/stats.js";
import { StubLLM } from "../src/llm.js";
import { generate } from "../src/pipeline.js";
import { addDays } from "../src/timeutil.js";
import { costOf, monthToDateCost, recordCall } from "../src/usage.js";
import { NOW, TODAY, exampleConfigData, generateReq, makeApp, makeCtx, type TestApp } from "./helpers.js";

const H = { "X-Early-Edition": "1" };
let t: TestApp | undefined;
let ctx: ReturnType<typeof makeCtx> | undefined;
afterEach(() => {
  t?.cleanup();
  ctx?.cleanup();
  t = undefined;
  ctx = undefined;
});

/** A story_closed event received at a given instant. */
function closed(c: { db: any }, storyId: number, receivedAt: string, seconds: number, finished = true) {
  c.db.run(
    "INSERT INTO events (device_id, client_event_id, story_id, type, ts, received_at, payload_json) VALUES ('d', ?, ?, 'story_closed', 0, ?, ?)",
    [
      `${storyId}-${receivedAt}-${seconds}`,
      storyId,
      receivedAt,
      JSON.stringify({ active_seconds: seconds, pages_total: 2, max_page: finished ? 2 : 1, finished }),
    ],
  );
}

describe("streak rules", () => {
  const set = (offsets: number[]) => new Set(offsets.map((o) => addDays(TODAY, o)));

  it("still counts a streak that ends yesterday", () => {
    expect(streakFrom(set([-1, -2, -3]), TODAY)).toMatchObject({ current: 3, current_since: addDays(TODAY, -3) });
    expect(streakFrom(set([0, -1]), TODAY)).toMatchObject({ current: 2, current_since: addDays(TODAY, -1) });
  });

  it("breaks on a gap", () => {
    expect(streakFrom(set([0, -2, -3]), TODAY)).toMatchObject({ current: 1, current_since: TODAY });
    expect(streakFrom(set([-2, -3]), TODAY)).toMatchObject({ current: 0, current_since: null });
    expect(streakFrom(new Set(), TODAY)).toEqual({ current: 0, current_since: null, longest: 0, longest_from: null, longest_to: null });
  });

  it("finds the longest run with its dates", () => {
    const s = streakFrom(set([-10, -9, -8, -7, -6, -1, 0]), TODAY);
    expect(s).toEqual({
      current: 2,
      current_since: addDays(TODAY, -1),
      longest: 5,
      longest_from: addDays(TODAY, -10),
      longest_to: addDays(TODAY, -6),
    });
  });
});

describe("reading stats", () => {
  it("counts a reading day by the date it was read, not the issue date, and sums minutes", async () => {
    ctx = makeCtx();
    await generate(ctx, "2026-11-12", NOW);
    const [a, b] = ctx.db.storiesFor("2026-11-12", 1).map((r) => Number(r.id));
    closed(ctx, a, "2026-11-14T07:10:00+00:00", 90);
    closed(ctx, b, "2026-11-14T07:20:00+00:00", 45);
    closed(ctx, b, "2026-11-13T23:30:00+00:00", 30, false); // 23:30 UTC is still the 13th in London in November
    const view = readingView(ctx, TODAY, 7);
    expect(view.from).toBe(addDays(TODAY, -6));
    expect(view.to).toBe(TODAY);
    expect(view.days.length).toBe(7);
    const day = (d: string) => view.days.find((x) => x.date === d)!;
    expect(day("2026-11-14")).toEqual({ date: "2026-11-14", issue: false, stories: 0, read: 2, minutes: 2.3 });
    expect(day("2026-11-12")).toEqual({ date: "2026-11-12", issue: true, stories: 6, read: 0, minutes: 0 });
    expect(day("2026-11-13").minutes).toBe(0.5);
    expect(day("2026-11-13").read).toBe(0);
    expect(view.reading_days).toBe(1);
    expect(view.total_read).toBe(2);
    expect(view.avg_read_per_day).toBe(0.3);
    expect(view.avg_minutes_per_day).toBe(0.4);
    expect(view.streak).toMatchObject({ current: 1, current_since: TODAY, longest: 1 });
    expect(view.topics.map((x) => x.name)).toEqual(ctx.config.topics.map((x) => x.name));
    expect(view.topics.reduce((n, x) => n + x.read, 0)).toBe(2);
  });

  it("fills every date of the calendar month", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const ids = ctx.db.storiesFor(TODAY, 1).map((r) => Number(r.id));
    for (const id of ids) closed(ctx, id, "2026-11-14T08:00:00+00:00", 60);
    const cal = calendarView(ctx, TODAY, "2026-11");
    expect(cal.month).toBe("2026-11");
    expect(cal.days.length).toBe(30);
    expect(cal.days.map((d) => d.date)).toEqual(Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`));
    const today = cal.days[13];
    expect(today).toMatchObject({ date: TODAY, issue: true, stories: 6, read: 6, minutes: 6, all_read: true });
    expect(cal.days[20]).toEqual({ date: "2026-11-21", issue: false, stories: 0, read: 0, minutes: 0, all_read: false });
    expect(cal.elapsed_days).toBe(14);
    expect(cal.total_read).toBe(6);
    expect(cal.reading_days).toBe(1);
    expect(cal.all_read_days).toBe(1);
    expect(calendarView(ctx, TODAY, "2026-02").days.length).toBe(28);
  });
});

describe("LLM usage and cost", () => {
  it("prices calls from the table, and an unknown model costs 0 and is flagged", () => {
    const data = exampleConfigData();
    data.llm_prices = { "my-model": { input_per_mtok: 1, output_per_mtok: 2 } };
    const cfg = parseConfig(data);
    expect(costOf(cfg, "claude-opus-5-5", 1_000_000, 1_000_000)).toEqual({ cost: 24, priced: true });
    expect(costOf(cfg, "claude-sonnet-5-5", 500_000, 100_000).cost).toBeCloseTo(2);
    expect(costOf(cfg, "claude-haiku-5-5", 2_000_000, 1_000_000).cost).toBeCloseTo(0.7);
    expect(costOf(cfg, "my-model", 1_000_000, 1_000_000).cost).toBe(3);
    expect(costOf(cfg, "mystery", 1_000_000, 1_000_000)).toEqual({ cost: 0, priced: false });

    ctx = makeCtx();
    const runId = ctx.db.startRun(TODAY);
    const scope = { runId, jobId: null, at: NOW };
    recordCall(ctx.db, ctx.config, scope, "rewrite", { provider: "anthropic", model: "claude-opus-5-5", input_tokens: 10_000, output_tokens: 2_000, stop_reason: "end_turn" });
    const check = recordCall(ctx.db, ctx.config, scope, "check", { provider: "anthropic", model: "claude-opus-5", input_tokens: 5_000, output_tokens: 500, stop_reason: "refusal" });
    ctx.db.run("UPDATE llm_calls SET outcome = 'sent_back' WHERE id = ?", [check]);
    expect(ctx.db.queryOne("SELECT priced FROM llm_calls WHERE id = ?", [check])!.priced).toBe(0);
    ctx.db.finishRun(runId, "created", []);
    const rc = runCost(ctx, ctx.db.queryOne("SELECT * FROM runs WHERE id = ?", [runId])!);
    expect(rc.calls).toBe(2);
    expect(rc.cost_usd).toBeCloseTo(0.08); // 10k x $4/M + 2k x $20/M; the unknown model adds 0
    expect(rc.input_tokens).toBe(15_000);
    expect(rc.sent_back).toBe(1);
    expect(rc.refused).toBe(1);
    expect(rc.models).toEqual(["claude-opus-5-5", "claude-opus-5"]);
    expect(rc.stages).toEqual([
      { stage: "rewrite", calls: 1, cost_usd: 0.08 },
      { stage: "check", calls: 1, cost_usd: 0 },
    ]);
    expect(monthToDateCost(ctx.db, NOW)).toBeCloseTo(0.08);
  });

  it("records every call of a stub generation against its run, at cost 0", async () => {
    ctx = makeCtx();
    await generate(ctx, TODAY, NOW);
    const calls = ctx.db.query("SELECT * FROM llm_calls");
    expect(calls.length).toBe(13); // 1 select + 6 rewrites + 6 checks
    expect(new Set(calls.map((c) => c.stage))).toEqual(new Set(["select", "rewrite", "check"]));
    expect(calls.every((c) => c.run_id !== null && c.cost_usd === 0 && c.input_tokens > 0 && c.model === "stub")).toBe(true);
    expect(calls.filter((c) => c.stage === "check").every((c) => c.outcome === "pass")).toBe(true);
  });
});

describe("AI settings", () => {
  it("falls back to env values, then persists dashboard changes over them", () => {
    ctx = makeCtx();
    const env = makeSettings({ llmProvider: "anthropic", llmApiKey: "k", llmModel: "claude-sonnet-5-5", checkLlmEffort: "medium" });
    expect(effectiveAiSettings(env, ctx.db)).toEqual({
      provider: "anthropic",
      writer_model: "anthropic:claude-sonnet-5-5",
      check_model: "anthropic:claude-sonnet-5-5",
      writer_effort: "medium",
      check_effort: "medium",
      monthly_limit_usd: null,
    });
    expect(effectiveAiSettings(makeSettings({ llmProvider: "anthropic" }), ctx.db)).toMatchObject({
      writer_model: "anthropic:claude-opus-5-5",
      writer_effort: "medium",
      check_effort: "high",
    });
    updateAiSettings(env, ctx.db, ctx.config, { check_model: "claude-haiku-5-5", writer_effort: "low", monthly_limit_usd: 5 }); // a bare id means anthropic
    expect(effectiveAiSettings(env, ctx.db)).toMatchObject({
      writer_model: "anthropic:claude-sonnet-5-5",
      check_model: "anthropic:claude-haiku-5-5",
      writer_effort: "low",
      monthly_limit_usd: 5,
    });
    updateAiSettings(env, ctx.db, ctx.config, { monthly_limit_usd: null });
    expect(effectiveAiSettings(env, ctx.db).monthly_limit_usd).toBeNull();
    expect(effectiveAiSettings(env, ctx.db).check_model).toBe("anthropic:claude-haiku-5-5"); // other values kept
  });

  it("validates PUT /ai and needs the header", async () => {
    t = makeApp({ settings: { llmProvider: "anthropic", llmApiKey: "k", llmBaseUrl: "" } });
    const put = (body: unknown) => t!.agent.put("/api/dashboard/ai").set(H).send(body as object);
    expect((await t.agent.put("/api/dashboard/ai").send({ writer_effort: "low" })).status).toBe(403);
    for (const bad of [{ writer_model: "gpt-9" }, { check_effort: "max" }, { writer_effort: 3 }, { monthly_limit_usd: -1 }, { monthly_limit_usd: "10" }]) {
      const r = await put(bad);
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(r.body.error).toBeTruthy();
    }
    const ok = await put({ writer_model: "anthropic:claude-sonnet-5-5", check_effort: "medium", monthly_limit_usd: 12.5 });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ writer_model: "anthropic:claude-sonnet-5-5", check_effort: "medium", monthly_limit_usd: 12.5 });
    expect((await t.agent.get("/api/dashboard/ai")).body.settings.writer_model).toBe("anthropic:claude-sonnet-5-5");
    expect((await put({ monthly_limit_usd: null })).body.settings.monthly_limit_usd).toBeNull();
  });

  it("offers no models for the stub or openai providers", async () => {
    t = makeApp();
    const ai = (await t.agent.get("/api/dashboard/ai")).body;
    expect(ai.settings.provider).toBe("stub");
    expect(ai.models).toEqual([]);
    expect((await t.agent.put("/api/dashboard/ai").set(H).send({ writer_model: "claude-opus-5-5" })).status).toBe(400);
  });
});

describe("monthly limit", () => {
  it("skips the LLM and publishes the catch-up issue once the limit is reached", async () => {
    ctx = makeCtx();
    await generate(ctx, addDays(TODAY, -1), NOW); // yesterday's unopened stories for the catch-up
    const counting = new StubLLM();
    ctx.writer = counting;
    ctx.checker = counting;
    recordCall(ctx.db, ctx.config, { runId: null, jobId: null, at: NOW }, "rewrite", {
      provider: "anthropic", model: "claude-opus-5-5", input_tokens: 1_000_000, output_tokens: 0, stop_reason: "end_turn",
    });
    updateAiSettings(ctx.settings, ctx.db, ctx.config, { monthly_limit_usd: 3 }); // $4 spent

    const result = await generate(ctx, TODAY, NOW);
    expect(counting.calls).toEqual([]);
    expect(result.status).toBe("created");
    expect(result.fallback).toBe(true);
    expect(result.detail.some((l) => l.includes("monthly AI limit reached"))).toBe(true);
    expect(String(ctx.db.queryOne("SELECT detail FROM runs ORDER BY id DESC LIMIT 1")!.detail)).toContain("monthly AI limit reached");

    const add = await addArticle(ctx, { url: "https://example.test/news/a", when: "today", now: NOW });
    expect(add.ok).toBe(false);
    expect(add.message).toContain("Monthly AI limit reached");
    expect(counting.calls).toEqual([]);
  });
});

describe("AI view", () => {
  it("gives null estimates without data, then estimates from recorded tokens", async () => {
    t = makeApp({ settings: { llmProvider: "anthropic", llmApiKey: "k", llmBaseUrl: "" } });
    const before = (await t.agent.get("/api/dashboard/ai")).body;
    expect(before.models.map((m: any) => m.id)).toEqual(["anthropic:claude-opus-5-5", "anthropic:claude-sonnet-5-5", "anthropic:claude-haiku-5-5"]);
    expect(before.models[0]).toMatchObject({ provider: "anthropic", name: "Claude Opus 5.5", input_per_mtok: 4, output_per_mtok: 20, est_day_writer_usd: null, est_day_checker_usd: null });
    expect(before.last_run).toBeNull();
    expect(before.provider_last_used).toBeNull();
    expect(before.month.days.length).toBe(14);
    expect(before.quality).toEqual({ sent_back: 0, refused: 0, on_time: 0, issues: 0, avg_seconds: null });

    await generateReq(t); // the injected stub records tokens at cost 0
    const after = (await t.agent.get("/api/dashboard/ai")).body;
    const opus = after.models[0];
    // Writer: select 6200/450 + 6 x rewrite 2600/700 = 21800 in, 4650 out -> $0.0872 + $0.093.
    expect(opus.est_day_writer_usd).toBe(0.18);
    // Checker: 6 x 2300/160 = 13800 in, 960 out -> $0.0552 + $0.0192.
    expect(opus.est_day_checker_usd).toBe(0.07);
    expect(after.models[2].est_day_writer_usd).toBeLessThan(opus.est_day_writer_usd);
    expect(after.last_run).toMatchObject({ status: "created", calls: 13, cost_usd: 0, sent_back: 0, refused: 0, models: ["stub"] });
    expect(after.provider_last_used).toBe("stub");
    expect(after.quality.issues).toBe(1);
    expect(after.month).toMatchObject({ month: "2026-11", cost_usd: 0, limit_usd: null, projected_usd: 0 });

    const summary = (await t.agent.get("/api/dashboard/summary")).body;
    expect(summary.last_run_cost.run_id).toBe(after.last_run.run_id);
    expect(Object.keys(summary.streak_detail).sort()).toEqual(["current", "current_since", "longest", "longest_from", "longest_to"]);
    const reading = (await t.agent.get("/api/dashboard/reading?days=3")).body;
    expect(reading.days.length).toBe(7); // clamped to 7..120
    expect((await t.agent.get("/api/dashboard/calendar?month=2026-13")).status).toBe(400);
    expect((await t.agent.get("/api/dashboard/calendar")).body.month).toBe("2026-11");
    expect((await request(t.kindleApp).get("/api/dashboard/ai")).status).toBe(404);
  });
});
