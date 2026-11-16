import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { makeSettings } from "../src/config.js";
import {
  AnthropicLLM,
  FALLBACK_BETA,
  LLMError,
  LLMRefusal,
  LLMUnavailable,
  OpenAICompatLLM,
  StubLLM,
  buildLlms,
  modeFor,
  type AnthropicClientLike,
} from "../src/llm.js";
import { generate } from "../src/pipeline.js";
import { CHECK_SCHEMA } from "../src/schemas.js";
import { NOW, TODAY, makeCtx } from "./helpers.js";

type Reply = Record<string, any> | Error;

/** A mock of the SDK client: records each request and answers from a queue or a function. */
class MockClient implements AnthropicClientLike {
  calls: any[] = [];
  constructor(private answer: (params: any, n: number) => Reply) {}
  beta = {
    messages: {
      create: async (params: any) => {
        this.calls.push(params);
        const r = this.answer(params, this.calls.length);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const ok = (json: unknown, extra: Record<string, any> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  stop_details: null,
  content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(json) }],
  usage: { input_tokens: 1200, output_tokens: 340 },
  ...extra,
});

const refusal = (category: string | null) => ({
  model: "claude-opus-5-5",
  stop_reason: "refusal",
  stop_details: { type: "refusal", category, explanation: "declined by a classifier" },
  content: [],
  usage: { input_tokens: 900, output_tokens: 0 },
});

const llm = (client: AnthropicClientLike, effort: "medium" | "high" = "medium") =>
  new AnthropicLLM(client, "claude-opus-5-5", { effort, retries: 2, retryDelayMs: 0 });

const MESSAGES = [
  { role: "system" as const, content: "You are the editor." },
  { role: "user" as const, content: "Check this story." },
];

describe("Anthropic provider: request shape", () => {
  it("sends a structured-output request with effort and the default fallback, and no sampling params", async () => {
    const client = new MockClient(() => ok({ safe: true, supported: true, reasons: [] }));
    const lines: string[] = [];
    const reply = await llm(client, "high").chat(MESSAGES, { task: "check", schema: CHECK_SCHEMA, log: (l) => lines.push(l) });
    expect(JSON.parse(reply)).toEqual({ safe: true, supported: true, reasons: [] });

    const p = client.calls[0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.max_tokens).toBe(16000);
    expect(p.output_config).toEqual({ effort: "high", format: { type: "json_schema", schema: CHECK_SCHEMA } });
    expect(p.betas).toEqual([FALLBACK_BETA]);
    expect(FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(p.fallbacks).toBe("default");
    expect(p.system).toBe("You are the editor.");
    expect(p.messages).toEqual([{ role: "user", content: "Check this story." }]); // no assistant prefill
    for (const banned of ["thinking", "temperature", "top_p", "top_k", "stream"]) expect(p).not.toHaveProperty(banned);
    expect(lines).toEqual(["llm check: model=claude-opus-5-5 in=1200 out=340 stop=end_turn"]);
  });

  it("reads text blocks by type and notes when a fallback model served the reply", async () => {
    const client = new MockClient(() =>
      ok({ a: 1 }, { model: "claude-opus-5", usage: { input_tokens: 5, output_tokens: 6, iterations: [{ type: "fallback_message" }] } }),
    );
    const lines: string[] = [];
    expect(await llm(client).chat(MESSAGES, { task: "select", log: (l) => lines.push(l) })).toBe('{"a":1}');
    expect(lines[0]).toContain("served by fallback");
    expect(client.calls[0].output_config).toEqual({ effort: "medium" }); // no schema given, no format
  });
});

describe("Anthropic provider: stop reasons and errors", () => {
  it("turns a refusal into LLMRefusal with its category", async () => {
    const client = new MockClient(() => refusal("bio"));
    const err = await llm(client).chat(MESSAGES, { task: "rewrite" }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMRefusal);
    expect(err.category).toBe("bio");
    expect(client.calls.length).toBe(1); // a refusal is not retried client-side
  });

  it("retries max_tokens, then gives up with LLMError", async () => {
    const cut = { ...ok({}), stop_reason: "max_tokens", content: [{ type: "text", text: '{"tit' }] };
    const retried = new MockClient((_p, n) => (n === 1 ? cut : ok({ done: true })));
    expect(JSON.parse(await llm(retried).chat(MESSAGES, { task: "rewrite" }))).toEqual({ done: true });
    expect(retried.calls.length).toBe(2);

    const always = new MockClient(() => cut);
    const err = await llm(always).chat(MESSAGES, { task: "rewrite" }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err).not.toBeInstanceOf(LLMUnavailable);
    expect(always.calls.length).toBe(3);
  });

  it("retries rate limits, 5xx and connection errors", async () => {
    const errors = [
      new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers()),
      new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers()),
    ];
    const client = new MockClient((_p, n) => errors[n - 1] ?? ok({ fine: 1 }));
    expect(JSON.parse(await llm(client).chat(MESSAGES, { task: "select" }))).toEqual({ fine: 1 });
    expect(client.calls.length).toBe(3);

    const down = new MockClient(() => new Anthropic.APIConnectionError({ message: "socket hang up" }));
    await expect(llm(down).chat(MESSAGES, { task: "select" })).rejects.toBeInstanceOf(LLMUnavailable);
    expect(down.calls.length).toBe(3);
  });

  it("does not retry 400, 401 or 404", async () => {
    for (const e of [
      new Anthropic.BadRequestError(400, { type: "error" }, "bad", new Headers()),
      new Anthropic.AuthenticationError(401, { type: "error" }, "bad key", new Headers()),
      new Anthropic.NotFoundError(404, { type: "error" }, "model: nope", new Headers()),
    ]) {
      const client = new MockClient(() => e);
      await expect(llm(client).chat(MESSAGES, { task: "select" })).rejects.toBeInstanceOf(LLMUnavailable);
      expect(client.calls.length).toBe(1);
    }
  });
});

describe("provider selection", () => {
  it("chooses the provider from the environment", () => {
    expect(modeFor(makeSettings({ llmBaseUrl: "stub", llmProvider: "anthropic" }))).toBe("stub");
    expect(modeFor(makeSettings({ llmProvider: "anthropic" }))).toBe("providers");
    expect(modeFor(makeSettings({ llmApiKey: "k" }))).toBe("providers");
    expect(modeFor(makeSettings({ openrouterApiKey: "k" }))).toBe("providers");
    expect(modeFor(makeSettings({ llmProvider: "OpenAI", llmBaseUrl: "https://example.test/v1" }))).toBe("openai");
    expect(modeFor(makeSettings({ llmBaseUrl: "https://example.test/v1" }))).toBe("openai");
    expect(() => modeFor(makeSettings({}))).toThrow(LLMUnavailable);
    expect(() => modeFor(makeSettings({ llmProvider: "gemini" }))).toThrow(LLMUnavailable);
  });

  it("builds Claude clients with default models and efforts, and honours overrides", () => {
    const [w, c] = buildLlms(makeSettings({ llmProvider: "anthropic", llmApiKey: "sk-test" }));
    expect(w).toBeInstanceOf(AnthropicLLM);
    expect((w as AnthropicLLM).model).toBe("claude-opus-5-5");
    expect((c as AnthropicLLM).model).toBe("claude-opus-5-5");
    const mock = new MockClient(() => ok({}));
    const [w2, c2] = buildLlms(makeSettings({ llmProvider: "anthropic", llmApiKey: "k" }), mock);
    expect((w2 as AnthropicLLM).request(MESSAGES, { task: "rewrite" }).output_config).toEqual({ effort: "medium" });
    expect((c2 as AnthropicLLM).request(MESSAGES, { task: "check" }).output_config).toEqual({ effort: "high" });

    const custom = makeSettings({
      llmProvider: "anthropic",
      llmApiKey: "k",
      llmModel: "claude-opus-5",
      checkLlmModel: "claude-opus-5-5",
      llmEffort: "low",
      checkLlmEffort: "medium",
    });
    const [w3, c3] = buildLlms(custom, mock);
    expect((w3 as AnthropicLLM).request(MESSAGES, { task: "rewrite" })).toMatchObject({ model: "claude-opus-5", output_config: { effort: "low" } });
    expect((c3 as AnthropicLLM).request(MESSAGES, { task: "check" })).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium" } });

    expect(() => buildLlms(makeSettings({ llmProvider: "anthropic" }))).toThrow(/LLM_API_KEY/);
    expect(() => buildLlms(makeSettings({ llmProvider: "anthropic", llmApiKey: "k", llmEffort: "huge" }), mock)).toThrow(/effort/);
    expect(buildLlms(makeSettings({ llmBaseUrl: "https://openrouter.ai/api/v1", llmModel: "m" }))[0]).toBeInstanceOf(OpenAICompatLLM);
    expect(buildLlms(makeSettings({ llmBaseUrl: "stub" }))[0]).toBeInstanceOf(StubLLM);
  });
});

/**
 * A mock client that answers like Claude would, from the prompt text alone: it picks the first
 * candidates, writes a stub story from the source fields, passes every check, and declines
 * any article whose headline contains one of `refuse`.
 */
function scriptedClient(refuse: string[]) {
  const stub = new StubLLM();
  return new MockClient((p) => {
    const text: string = p.messages.map((m: any) => m.content).join("\n");
    const schema = p.output_config?.format?.schema ?? {};
    const props = Object.keys(schema.properties ?? {});
    if (props.includes("picks")) {
      const topic = schema.properties.picks.items.properties.topic.enum.includes("Science") ? "Science" : "Football";
      const ids = [...text.matchAll(/^\[(\d+)\] source:/gm)].map((m) => Number(m[1]));
      const asPick = (id: number) => ({ candidate_id: id, topic });
      return ok({ picks: ids.slice(0, 6).map(asPick), reserves: ids.slice(6, 10).map(asPick) });
    }
    if (props.includes("teaser")) {
      const field = (name: string) => text.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1] ?? "";
      const title = field("Headline");
      if (refuse.some((w) => title.includes(w))) return refusal("general_harms");
      const candidate = { title, sourceName: field("source_name"), url: field("source_url") };
      return ok(stub.rewrite({ candidate, topic: field("Topic for this story") }));
    }
    return ok({ safe: true, supported: true, reasons: [] });
  });
}

describe("Anthropic provider in the pipeline", () => {
  let ctx: ReturnType<typeof makeCtx>;
  afterEach(() => ctx?.cleanup());

  it("drops a refused story, uses a reserve, and logs usage in the run detail", async () => {
    ctx = makeCtx();
    const client = scriptedClient(["Wheelchair Rugby"]);
    ctx.writer = new AnthropicLLM(client, "claude-opus-5-5", { effort: "medium", retryDelayMs: 0 });
    ctx.checker = new AnthropicLLM(client, "claude-opus-5-5", { effort: "high", retryDelayMs: 0 });
    const result = await generate(ctx, TODAY, NOW);
    expect(result.status).toBe("created");
    expect(result.story_count).toBe(6);
    const rows = ctx.db.storiesFor(TODAY, 1);
    expect(rows.some((r) => String(r.source_title).includes("Wheelchair Rugby"))).toBe(false);
    expect(result.detail.some((l) => l.includes("writer declined") && l.includes("general_harms"))).toBe(true);
    expect(result.detail.filter((l) => l.includes("using reserve")).length).toBe(1);
    expect(result.detail.some((l) => /^llm select: model=claude-opus-5-5 in=\d+ out=\d+/.test(l))).toBe(true);
    expect(result.detail.some((l) => /^\[\d+\] llm rewrite: .*in=1200 out=340/.test(l))).toBe(true);
    // Effort per task: medium to select and write, high to check.
    const efforts = client.calls.map((c) => `${Object.keys(c.output_config.format.schema.properties).includes("safe") ? "check" : "other"}:${c.output_config.effort}`);
    expect(new Set(efforts)).toEqual(new Set(["other:medium", "check:high"]));
    // The run log the dashboard shows has the same lines.
    const run = ctx.db.queryOne("SELECT detail FROM runs ORDER BY id DESC LIMIT 1")!;
    expect(String(run.detail)).toContain("llm rewrite:");
  });
});

describe("AI settings reach the Anthropic requests", () => {
  let ctx: ReturnType<typeof makeCtx> | undefined;
  afterEach(() => ctx?.cleanup());

  it("uses the dashboard's model and effort from the next run, and only sends fallbacks where the model supports them", async () => {
    const { buildContext } = await import("../src/pipeline.js");
    const { updateAiSettings } = await import("../src/aisettings.js");
    const base = makeCtx();
    ctx = base;
    const client = scriptedClient([]);
    const settings = { ...base.settings, llmBaseUrl: "", llmProvider: "anthropic", llmApiKey: "k" };
    const c = buildContext(settings, base.config, base.db, {
      anthropicClient: client,
      feedFetcher: base.feedFetcher,
      pageFetcher: base.pageFetcher,
      imageFetcher: base.imageFetcher,
    });
    await generate(c, TODAY, NOW);
    expect(new Set(client.calls.map((p) => p.model))).toEqual(new Set(["claude-opus-5-5"]));
    expect(client.calls.every((p) => p.fallbacks === "default" && p.betas?.[0] === FALLBACK_BETA)).toBe(true);
    const opusCalls = client.calls.length;
    const recorded = base.db.query("SELECT model, cost_usd FROM llm_calls");
    expect(recorded.length).toBe(opusCalls);
    expect(recorded.every((r) => r.model === "anthropic:claude-opus-5-5" && r.cost_usd > 0)).toBe(true);

    updateAiSettings(settings, base.db, base.config, { writer_model: "anthropic:claude-haiku-5-5", check_model: "anthropic:claude-sonnet-5-5", writer_effort: "low" }, { anthropic: true });
    await generate(c, TODAY, NOW, true);
    const next = client.calls.slice(opusCalls);
    const haiku = next.filter((p) => p.model === "claude-haiku-5-5");
    const sonnet = next.filter((p) => p.model === "claude-sonnet-5-5");
    expect(haiku.length + sonnet.length).toBe(next.length);
    expect(haiku.every((p) => p.output_config.effort === "low" && !("fallbacks" in p) && !("betas" in p))).toBe(true);
    expect(sonnet.every((p) => p.output_config.effort === "high" && p.fallbacks === "default")).toBe(true);
    for (const p of next) for (const banned of ["thinking", "temperature", "top_p", "top_k"]) expect(p).not.toHaveProperty(banned);
  });
});
