import { describe, expect, it } from "vitest";
import { runComparison } from "../scripts/compare-models.js";
import { StubLLM } from "../src/llm.js";
import { NOW, TODAY, exampleConfig, fixtureFeedFetcher, fixturePageFetcher, testSettings, tmpDir } from "./helpers.js";

/** Answers like a model would, from the prompt alone. */
function answer(text: string, schema: any): unknown {
  const props = Object.keys(schema?.properties ?? {});
  if (props.includes("picks")) {
    const ids = [...text.matchAll(/^\[(\d+)\] source:/gm)].map((m) => Number(m[1]));
    const asPick = (id: number) => ({ candidate_id: id, topic: "Science" });
    return { picks: ids.slice(0, 6).map(asPick), reserves: ids.slice(6, 10).map(asPick) };
  }
  if (props.includes("teaser")) {
    const field = (name: string) => text.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
    const candidate = { title: field("Headline"), sourceName: field("source_name"), url: field("source_url") };
    return new StubLLM().rewrite({ candidate, topic: field("Topic for this story") });
  }
  return { safe: true, supported: true, reasons: [] };
}

describe("model comparison harness", () => {
  it("runs end to end with stubbed providers and writes the expected shape", async () => {
    const anthropicCalls: any[] = [];
    const anthropic = {
      beta: {
        messages: {
          create: async (p: any) => {
            anthropicCalls.push(p);
            const text = p.messages.map((m: any) => m.content).join("\n");
            return {
              model: p.model,
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(answer(text, p.output_config?.format?.schema)) }],
              usage: { input_tokens: 3000, output_tokens: 600 },
            };
          },
        },
      },
    };
    const orBodies: any[] = [];
    const openrouterFetch = (async (_url: any, init: any) => {
      const body = JSON.parse(String(init.body));
      orBodies.push(body);
      const text = body.messages.map((m: any) => m.content).join("\n");
      // GLM refuses one particular article, to show a refusal is recorded and the run carries on.
      const refuse = text.includes("Headline: England beat France");
      return Response.json({
        model: body.model,
        choices: [
          refuse
            ? { finish_reason: "content_filter", message: { content: "" } }
            : { finish_reason: "stop", message: { content: JSON.stringify(answer(text, body.response_format?.json_schema?.schema)) } },
        ],
        usage: { prompt_tokens: 3000, completion_tokens: 900, cost: 0.004 },
      });
    }) as typeof fetch;

    const dir = tmpDir();
    const settings = { ...testSettings(dir), llmBaseUrl: "", llmApiKey: "test-anthropic", openrouterApiKey: "test-openrouter" };
    const lines: string[] = [];
    const out = await runComparison({
      settings,
      config: exampleConfig(),
      date: TODAY,
      now: NOW,
      writers: ["anthropic:claude-opus-5-5", "openrouter:z-ai/glm-5.3"],
      checker: "anthropic:claude-opus-5-5",
      clients: { anthropic, openrouterFetch },
      feedFetcher: fixtureFeedFetcher,
      pageFetcher: fixturePageFetcher,
      log: (l) => lines.push(l),
    });

    expect(out.meta).toMatchObject({ date: TODAY, story_count: 6, selector: "anthropic:claude-opus-5-5", selector_used: "anthropic:claude-opus-5-5", checker: "anthropic:claude-opus-5-5" });
    expect(out.meta.candidates).toBeGreaterThan(10);
    expect(Object.keys(out.meta.feed_counts)).toHaveLength(exampleConfig().feeds.length);
    expect(out.meta.filter.kept).toBe(out.meta.candidates);
    expect(out.models.map((m: any) => [m.id, m.name, m.provider])).toEqual([
      ["anthropic:claude-opus-5-5", "Claude Opus 5.5", "anthropic"],
      ["openrouter:z-ai/glm-5.3", "GLM 5.3 (OpenRouter)", "openrouter"],
    ]);
    for (const id of ["anthropic:claude-opus-5-5", "openrouter:z-ai/glm-5.3"]) {
      expect(out.selection[id].picks).toHaveLength(6);
      expect(out.selection[id].error).toBeNull();
      expect(out.selection[id].picks[0]).toEqual(expect.objectContaining({ candidate_id: expect.any(Number), title: expect.any(String), source: expect.any(String), topic: "Science" }));
    }
    expect(out.stories).toHaveLength(6);
    for (const s of out.stories) {
      expect(s.excerpt.length).toBeGreaterThan(100);
      expect(s.excerpt.length).toBeLessThanOrEqual(600);
      expect(Object.keys(s.results).sort()).toEqual(["anthropic:claude-opus-5-5", "openrouter:z-ai/glm-5.3"]);
    }
    const opus = out.stories[0].results["anthropic:claude-opus-5-5"];
    expect(opus.story).toEqual(expect.objectContaining({ title: expect.any(String), body: expect.any(Array), think_about_it: expect.any(String) }));
    expect(opus.validation).toEqual({ ok: true, reasons: [] });
    expect(opus.checker).toMatchObject({ safe: true, supported: true });
    expect(opus.writer_usage).toMatchObject({ input_tokens: 3000, output_tokens: 600, cost_usd: 0.024 });

    // One attempt each: every writer rewrites every shared pick exactly once; the checker sees every story written.
    const writerCalls = anthropicCalls.filter((p) => !Object.keys(p.output_config.format.schema.properties).includes("safe"));
    expect(writerCalls.length).toBe(1 + 6); // select + 6 rewrites
    expect(orBodies.length).toBe(1 + 6);
    expect(writerCalls.every((p) => p.output_config.effort === "medium")).toBe(true);
    const checks = anthropicCalls.filter((p) => Object.keys(p.output_config.format.schema.properties).includes("safe"));
    expect(checks.every((p) => p.output_config.effort === "high")).toBe(true);

    const opusTotals = out.totals["anthropic:claude-opus-5-5"];
    expect(opusTotals).toMatchObject({ stories_written: 6, passed_validation: 6, passed_checker: 6, sent_back: 0, refused: 0 });
    expect(opusTotals.avg_words).toBeGreaterThanOrEqual(100);
    expect(opusTotals.writer_cost_usd).toBeCloseTo(7 * 0.024);
    expect(opusTotals.checker_cost_usd).toBeCloseTo(6 * 0.024);
    const glm = out.totals["openrouter:z-ai/glm-5.3"];
    expect(glm.writer_cost_usd).toBeCloseTo(7 * 0.004);
    expect(glm.refused + glm.stories_written).toBe(6);
    expect(checks.length).toBe(opusTotals.stories_written + glm.stories_written);
    expect(lines.some((l) => l.startsWith("[compare] select anthropic:claude-opus-5-5"))).toBe(true);
    expect(JSON.stringify(out)).not.toContain("test-anthropic"); // keys never appear in the output
  });

  it("stops starting calls once the budget is spent", async () => {
    const anthropic = {
      beta: {
        messages: {
          create: async (p: any) => {
            const text = p.messages.map((m: any) => m.content).join("\n");
            return {
              model: p.model,
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(answer(text, p.output_config?.format?.schema)) }],
              usage: { input_tokens: 100_000, output_tokens: 0 }, // $0.40 each at Opus prices
            };
          },
        },
      },
    };
    const dir = tmpDir();
    const out = await runComparison({
      settings: { ...testSettings(dir), llmBaseUrl: "", llmApiKey: "k" },
      config: exampleConfig(),
      date: TODAY,
      now: NOW,
      writers: ["anthropic:claude-opus-5-5"],
      checker: "anthropic:claude-opus-5-5",
      clients: { anthropic },
      feedFetcher: fixtureFeedFetcher,
      pageFetcher: fixturePageFetcher,
      budgetUsd: 1,
      log: () => {},
    });
    expect(out.meta.spent_usd).toBeLessThan(2);
    const skipped = out.stories.filter((s: any) => String(s.results["anthropic:claude-opus-5-5"].error ?? "").includes("budget"));
    expect(skipped.length).toBeGreaterThan(0);
  });
});
