import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { migrateStoredModelIds, updateAiSettings } from "../src/aisettings.js";
import { LLMError, LLMRefusal, LLMUnavailable, OpenRouterLLM, StubLLM, type CallUsage } from "../src/llm.js";
import { buildContext, generate } from "../src/pipeline.js";
import { CHECK_SCHEMA } from "../src/schemas.js";
import { recordCall } from "../src/usage.js";
import { runCost } from "../src/dashboard/stats.js";
import { NOW, TODAY, makeApp, makeCtx, type TestApp } from "./helpers.js";

const H = { "X-Early-Edition": "1" };
let t: TestApp | undefined;
let ctx: ReturnType<typeof makeCtx> | undefined;
afterEach(() => {
  t?.cleanup();
  ctx?.cleanup();
  t = undefined;
  ctx = undefined;
});

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/** A mock fetch for OpenRouter: records requests and answers from a function. */
function mockFetch(answer: (body: any, n: number) => Response | Error) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    seen.push({ url: String(url), headers: init.headers, body });
    const r = answer(body, seen.length);
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { seen, fetchImpl };
}

const reply = (content: unknown, extra: Record<string, any> = {}) =>
  Response.json({
    id: "gen-1",
    model: "moonshotai/kimi-k3.1-pro-20261101",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 3000, completion_tokens: 800, total_tokens: 3800, cost: 0.0123 },
    ...extra,
  });

const MESSAGES = [
  { role: "system" as const, content: "You check stories." },
  { role: "user" as const, content: "Check this one." },
];

const llm = (fetchImpl: typeof fetch, effort: "low" | "medium" | "high" = "high") =>
  new OpenRouterLLM("or-key", "moonshotai/kimi-k3.1-pro", { effort, fetchImpl, retryDelayMs: 0 });

describe("OpenRouter requests", () => {
  it("sends the OpenAI-compatible shape with a strict JSON schema, reasoning effort and usage", async () => {
    const { seen, fetchImpl } = mockFetch(() => reply({ safe: true, supported: true, reasons: [] }));
    const usages: CallUsage[] = [];
    const out = await llm(fetchImpl).chat(MESSAGES, { task: "check", schema: CHECK_SCHEMA, onUsage: (u) => usages.push(u) });
    expect(JSON.parse(out)).toEqual({ safe: true, supported: true, reasons: [] });
    const r = seen[0];
    expect(r.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(r.headers.Authorization).toBe("Bearer or-key");
    expect(r.headers["X-Title"]).toBe("Early Edition Kids");
    expect(Object.keys(r.headers).some((h) => /referer/i.test(h))).toBe(false);
    expect(r.body).toEqual({
      model: "moonshotai/kimi-k3.1-pro",
      messages: MESSAGES,
      max_tokens: 16000,
      reasoning: { effort: "high" },
      usage: { include: true },
      response_format: { type: "json_schema", json_schema: { name: "check", strict: true, schema: CHECK_SCHEMA } },
    });
    expect(usages).toEqual([
      {
        provider: "openrouter",
        model: "openrouter:moonshotai/kimi-k3.1-pro-20261101", // the model OpenRouter reports
        input_tokens: 3000,
        output_tokens: 800,
        stop_reason: "stop",
        cost_usd: 0.0123,
      },
    ]);
  });

  it("records OpenRouter's own cost when it is reported, else the price table", () => {
    ctx = makeCtx();
    const scope = { runId: null, jobId: null, at: NOW };
    const base = { provider: "openrouter", input_tokens: 1_000_000, output_tokens: 100_000, stop_reason: "stop" };
    const reported = recordCall(ctx.db, ctx.config, scope, "rewrite", { ...base, model: "openrouter:x-ai/grok-4.7", cost_usd: 1.5 });
    const table = recordCall(ctx.db, ctx.config, scope, "rewrite", { ...base, model: "openrouter:x-ai/grok-4.7" });
    const unknown = recordCall(ctx.db, ctx.config, scope, "rewrite", { ...base, model: "openrouter:someone/new-model" });
    const row = (id: number) => ctx!.db.queryOne("SELECT cost_usd, priced FROM llm_calls WHERE id = ?", [id])!;
    expect(row(reported).cost_usd).toBe(1.5);
    expect(row(table).cost_usd).toBeCloseTo(2 + 0.6); // grok 4.7: $2 in, $6 out per million
    expect(row(unknown)).toEqual({ cost_usd: 0, priced: 0 });
  });

  it("retries once when the reply is cut off by length", async () => {
    const cut = () => reply("{\"tit", { choices: [{ finish_reason: "length", message: { content: "{\"tit" } }] });
    const once = mockFetch((_b, n) => (n === 1 ? cut() : reply({ ok: 1 })));
    expect(JSON.parse(await llm(once.fetchImpl).chat(MESSAGES, { task: "rewrite" }))).toEqual({ ok: 1 });
    expect(once.seen.length).toBe(2);
    const twice = mockFetch(() => cut());
    const err = await llm(twice.fetchImpl).chat(MESSAGES, { task: "rewrite" }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err).not.toBeInstanceOf(LLMUnavailable);
    expect(twice.seen.length).toBe(2);
  });

  it("treats 402 as out of credit with a plain message, and does not retry 4xx", async () => {
    const lines: string[] = [];
    const credit = mockFetch(() => Response.json({ error: { code: 402, message: "Insufficient credits" } }, { status: 402 }));
    const err = await llm(credit.fetchImpl).chat(MESSAGES, { task: "select", log: (l) => lines.push(l) }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMUnavailable);
    expect(err.message).toContain("OpenRouter is out of credit");
    expect(lines[0]).toContain("Add credit at openrouter.ai");
    expect(credit.seen.length).toBe(1);
    for (const status of [400, 401, 403]) {
      const m = mockFetch(() => Response.json({ error: { code: status, message: "no" } }, { status }));
      await expect(llm(m.fetchImpl).chat(MESSAGES, { task: "select" })).rejects.toBeInstanceOf(LLMUnavailable);
      expect(m.seen.length).toBe(1);
    }
    const flaky = mockFetch((_b, n) => (n === 1 ? new Response("", { status: 429 }) : n === 2 ? new TypeError("fetch failed") : reply({ fine: 1 })));
    expect(JSON.parse(await llm(flaky.fetchImpl).chat(MESSAGES, { task: "select" }))).toEqual({ fine: 1 });
    expect(flaky.seen.length).toBe(3);
  });

  it("treats a content filter or refusal as a refusal", async () => {
    const filtered = mockFetch(() => reply("", { choices: [{ finish_reason: "content_filter", message: { content: "" } }] }));
    await expect(llm(filtered.fetchImpl).chat(MESSAGES, { task: "rewrite" })).rejects.toBeInstanceOf(LLMRefusal);
    const refused = mockFetch(() => reply(null, { choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help with that." } }] }));
    await expect(llm(refused.fetchImpl).chat(MESSAGES, { task: "rewrite" })).rejects.toBeInstanceOf(LLMRefusal);
  });
});

/** Answers like a model would, from the prompt alone (as in anthropic.test.ts). */
function scriptedJson(text: string, schema: any): unknown {
  const props = Object.keys(schema?.properties ?? {});
  if (props.includes("picks")) {
    const topic = schema.properties.picks.items.properties.topic.enum.includes("Science") ? "Science" : "Football";
    const ids = [...text.matchAll(/^\[(\d+)\] source:/gm)].map((m) => Number(m[1]));
    const asPick = (id: number) => ({ candidate_id: id, topic });
    return { picks: ids.slice(0, 6).map(asPick), reserves: ids.slice(6, 10).map(asPick) };
  }
  if (props.includes("teaser")) {
    const field = (name: string) => text.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
    const candidate = { title: field("Headline"), sourceName: field("source_name"), url: field("source_url") };
    return new StubLLM().rewrite({ candidate, topic: field("Topic for this story") });
  }
  return { safe: true, supported: true, reasons: [] };
}

describe("both providers in one run", () => {
  it("writes with an OpenRouter model and checks with Claude", async () => {
    const base = makeCtx();
    ctx = base;
    const or = mockFetch((body) => {
      const text = body.messages.map((m: any) => m.content).join("\n");
      return reply(scriptedJson(text, body.response_format.json_schema.schema), { model: body.model });
    });
    const anthropicCalls: any[] = [];
    const anthropic = {
      beta: {
        messages: {
          create: async (p: any) => {
            anthropicCalls.push(p);
            return {
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify({ safe: true, supported: true, reasons: [] }) }],
              usage: { input_tokens: 2000, output_tokens: 100 },
            };
          },
        },
      },
    };
    const settings = { ...base.settings, llmBaseUrl: "", llmApiKey: "anthropic-key", openrouterApiKey: "or-key" };
    const c = buildContext(settings, base.config, base.db, {
      anthropicClient: anthropic,
      openrouterFetch: or.fetchImpl,
      feedFetcher: base.feedFetcher,
      pageFetcher: base.pageFetcher,
      imageFetcher: base.imageFetcher,
    });
    updateAiSettings(settings, base.db, base.config, {
      writer_model: "openrouter:moonshotai/kimi-k3.1-pro",
      check_model: "anthropic:claude-opus-5-5",
    });
    const result = await generate(c, TODAY, NOW);
    expect(result.status).toBe("created");
    expect(result.story_count).toBe(6);
    expect(or.seen.length).toBe(7); // select + 6 rewrites
    expect(or.seen.every((s) => s.body.model === "moonshotai/kimi-k3.1-pro" && s.body.reasoning.effort === "medium")).toBe(true);
    expect(anthropicCalls.length).toBe(6);
    expect(anthropicCalls.every((p) => p.model === "claude-opus-5-5" && p.output_config.effort === "high")).toBe(true);

    const run = base.db.queryOne("SELECT * FROM runs ORDER BY id DESC LIMIT 1")!;
    const rc = runCost(c, run);
    expect(rc.models).toEqual(["openrouter:moonshotai/kimi-k3.1-pro", "anthropic:claude-opus-5-5"]);
    expect(rc.cost_usd).toBeCloseTo(7 * 0.0123 + 6 * (2000 * 4 + 100 * 20) / 1e6);
    const providers = new Set(base.db.query("SELECT stage, provider FROM llm_calls").map((r) => `${r.stage}:${r.provider}`));
    expect(providers).toEqual(new Set(["select:openrouter", "rewrite:openrouter", "check:anthropic"]));
  });
});

describe("settings with two providers", () => {
  it("rejects a model whose provider isn't configured, and offers every configured provider's models", async () => {
    t = makeApp({ settings: { llmProvider: "anthropic", llmApiKey: "k", llmBaseUrl: "" } });
    const r = await t.agent.put("/api/dashboard/ai").set(H).send({ writer_model: "openrouter:x-ai/grok-4.7" });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("OpenRouter isn't set up");
    const ai = (await t.agent.get("/api/dashboard/ai")).body;
    expect(ai.providers).toEqual([
      { id: "anthropic", name: "Anthropic", description: "Claude models, with your Anthropic key", configured: true, last_used: null },
      { id: "openrouter", name: "OpenRouter", description: "Many models with one key", configured: false, last_used: null },
    ]);
    expect(ai.models.every((m: any) => m.provider === "anthropic")).toBe(true);
    t.cleanup();

    t = makeApp({ settings: { llmApiKey: "k", openrouterApiKey: "or", llmBaseUrl: "" } });
    const both = (await t.agent.get("/api/dashboard/ai")).body;
    expect(both.providers.map((p: any) => p.configured)).toEqual([true, true]);
    const ids = both.models.map((m: any) => m.id);
    expect(ids).toContain("anthropic:claude-opus-5-5");
    expect(ids).toContain("openrouter:anthropic/claude-opus-5.5");
    expect(ids).toContain("openrouter:z-ai/glm-5.3");
    expect(ids).toContain("openrouter:deepseek/deepseek-v4-pro-0813");
    expect(ids).not.toContain("openrouter:z-ai/glm-5.3-prime");
    const grok = both.models.find((m: any) => m.id === "openrouter:x-ai/grok-4.7");
    expect(grok).toMatchObject({ provider: "openrouter", name: "Grok 4.7 (OpenRouter)", input_per_mtok: 2, output_per_mtok: 6 });
    const ok = await t.agent.put("/api/dashboard/ai").set(H).send({ writer_model: "openrouter:x-ai/grok-4.7" });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ provider: "openrouter", writer_model: "openrouter:x-ai/grok-4.7" });
    expect((await t.agent.put("/api/dashboard/ai").set(H).send({ writer_model: "openrouter:nobody/nothing" })).status).toBe(400);
    expect((await request(t.kindleApp).get("/api/dashboard/ai")).status).toBe(404);
  });

  it("migrates stored bare model ids to namespaced ones", () => {
    ctx = makeCtx();
    ctx.db.run("INSERT INTO settings (key, value) VALUES ('ai', ?)", [JSON.stringify({ writer_model: "claude-sonnet-5-5", check_model: "claude-haiku-5-5", writer_effort: "low" })]);
    const settings = { ...ctx.settings, llmBaseUrl: "", llmProvider: "anthropic", llmApiKey: "k" };
    migrateStoredModelIds(settings, ctx.db);
    const stored = JSON.parse(String(ctx.db.queryOne("SELECT value FROM settings WHERE key = 'ai'")!.value));
    expect(stored).toEqual({ writer_model: "anthropic:claude-sonnet-5-5", check_model: "anthropic:claude-haiku-5-5", writer_effort: "low" });
  });
});
