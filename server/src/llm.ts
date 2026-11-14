/**
 * LLM access behind one interface: the Anthropic Messages API (default for the owner: Claude Opus 5.5),
 * any OpenAI-compatible /chat/completions endpoint (e.g. OpenRouter), and a deterministic stub.
 */

import Anthropic from "@anthropic-ai/sdk";
import { isStub, type Settings } from "./config.js";
import { DEFAULT_ANTHROPIC_MODEL, OPENROUTER_BASE_URL, isLegacyOpenAI, splitModel } from "./providers.js";
import type { CallUsage } from "./usage.js";
import { countWords } from "./validate.js";
export type { CallUsage };
import type { Candidate } from "./feeds.js";

/** The model answered, but not with something usable. */
export class LLMError extends Error {}
/** The endpoint could not be reached or refused the request. */
export class LLMUnavailable extends Error {}
/** The model declined (stop_reason "refusal"). The candidate must be dropped, never published. */
export class LLMRefusal extends LLMError {
  constructor(readonly category: string | null, explanation?: string | null) {
    super(`the model declined (category: ${category ?? "none given"})${explanation ? `: ${explanation}` : ""}`);
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** select | rewrite | check */
  task: string;
  /** Structured data for the stub; real providers ignore it. */
  context?: Record<string, any>;
  /** JSON schema for structured outputs (Anthropic). The OpenAI-compatible path ignores it. */
  schema?: Record<string, unknown>;
  /** Per-call log line (usage, stop reason) for the run detail. */
  log?: (line: string) => void;
  /** Called once per API response received (including retried ones), for usage and cost. */
  onUsage?: (usage: CallUsage) => void;
}

export interface LLM {
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<string>;
}

// ---- defensive JSON parsing ----

const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
const THINK = /<think>[\s\S]*?<\/think>/gi;

/** Every balanced top-level {...} substring, respecting JSON strings. */
function outerObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"' && depth > 0) inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parse the model's reply into an object. Never relies on response_format.
 * Strips <think> blocks and code fences, then tries the whole text, then each balanced outer
 * object (largest first), then first '{' to last '}'. Tolerates trailing commas.
 */
export function parseJsonObject(text: unknown): Record<string, any> {
  if (typeof text !== "string") throw new LLMError("reply is not text");
  const cleaned = text.replace(THINK, "").trim();
  const attempts: string[] = [];
  for (const m of cleaned.matchAll(FENCE)) attempts.push(m[1].trim());
  attempts.push(cleaned);
  attempts.push(...outerObjects(cleaned).sort((a, b) => b.length - a.length));
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) attempts.push(cleaned.slice(first, last + 1));
  for (const candidate of attempts) {
    if (!candidate) continue;
    for (const variant of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        const value = JSON.parse(variant);
        if (isObject(value)) return value;
        break;
      } catch {
        // try the next variant
      }
    }
  }
  throw new LLMError(`no JSON object in reply: ${JSON.stringify(cleaned.slice(0, 200))}`);
}

// ---- OpenAI-compatible client ----

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpenAIOptions {
  timeoutMs?: number;
  retries?: number;
  temperature?: number;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

export class OpenAICompatLLM implements LLM {
  readonly url: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly temperature: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(baseUrl: string, private readonly apiKey: string, readonly model: string, opts: OpenAIOptions = {}) {
    this.url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    this.timeoutMs = opts.timeoutMs ?? 180_000;
    this.retries = opts.retries ?? 2;
    this.temperature = opts.temperature ?? 0.4;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 2000;
  }

  async chat(messages: ChatMessage[], { task, onUsage }: ChatOptions): Promise<string> {
    if (!this.model) throw new LLMUnavailable("LLM_MODEL is not set");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const body = JSON.stringify({ model: this.model, messages, temperature: this.temperature });
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await sleep(this.retryDelayMs * attempt);
      let resp: Response;
      try {
        resp = await this.fetchImpl(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        lastErr = err;
        console.warn(`LLM ${task} call failed (attempt ${attempt + 1}): ${String(err)}`);
        continue;
      }
      if (resp.status === 429 || resp.status >= 500) {
        lastErr = new LLMUnavailable(`HTTP ${resp.status}`);
        console.warn(`LLM ${task} call got HTTP ${resp.status} (attempt ${attempt + 1})`);
        continue;
      }
      const text = await resp.text();
      if (resp.status >= 400) throw new LLMUnavailable(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      if (onUsage) {
        try {
          const data = JSON.parse(text);
          onUsage({
            provider: "openai",
            model: `openai:${typeof data.model === "string" && data.model ? data.model : this.model}`,
            input_tokens: Number(data.usage?.prompt_tokens) || 0,
            output_tokens: Number(data.usage?.completion_tokens) || 0,
            stop_reason: data.choices?.[0]?.finish_reason ?? null,
          });
        } catch {
          // an unreadable body is reported by content() below
        }
      }
      return OpenAICompatLLM.content(text);
    }
    throw new LLMUnavailable(`${task}: ${String(lastErr)}`);
  }

  static content(text: string): string {
    let content: unknown;
    try {
      content = JSON.parse(text).choices[0].message.content;
    } catch {
      throw new LLMError(`unexpected response shape: ${JSON.stringify(text.slice(0, 200))}`);
    }
    if (Array.isArray(content)) {
      // some providers return content parts
      content = content.map((p) => (isObject(p) && typeof p.text === "string" ? p.text : "")).join("");
    }
    if (typeof content !== "string" || !content) throw new LLMError("empty reply");
    return content;
  }
}

// ---- stub ----

const KEYWORDS: Array<[string, string[]]> = [
  ["Liverpool FC", ["liverpool", "anfield", "reds"]],
  ["England", ["england", "three lions", "tuchel", "wembley"]],
  ["Football", ["football", "goal", "premier league", "striker", "kane", "messi", "ronaldo", "fc", "cup"]],
  ["Space", ["space", "mars", "moon", "nasa", "rocket", "planet", "star", "astronaut", "rover"]],
  ["Animals and nature", ["animal", "bird", "seal", "turtle", "snake", "penguin", "zoo", "ant", "capybara", "nature"]],
  ["Games and tech", ["game", "gamer", "robot", "ai", "computer", "microsoft", "tech", "app"]],
  ["Weather", ["weather", "cold", "snow", "storm", "rain", "heatwave", "temperature"]],
  ["Science", ["science", "scientist", "study", "research", "dinosaur", "chemical"]],
];

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function stubGuessTopic(title: string, summary: string, allowed: string[]): string {
  const text = ` ${title} ${summary} `.toLowerCase();
  for (const [topic, words] of KEYWORDS) {
    if (allowed.includes(topic) && words.some((w) => new RegExp(`\\b${reEscape(w)}\\b`).test(text))) return topic;
  }
  for (const fallback of ["Weird but true", "Science"]) if (allowed.includes(fallback)) return fallback;
  return allowed[0];
}

export function cutText(text: string, limit: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const sp = cut.lastIndexOf(" ");
  return (sp === -1 ? cut : cut.slice(0, sp)).replace(/[ ,;:\-–—]+$/, "");
}

const STUB_PARAGRAPHS = [
  "This is a practice story made by the Early Edition Kids test writer. It is about the news item named in the title. " +
    "A real writer would tell you what happened in short and simple sentences.",
  "The story comes from {source}. The people who wrote the first version found out what happened and shared it. " +
    "Early Edition Kids reads it and makes it easier to read for a young reader.",
  "Every story has a few short parts. First you find out what happened. Then you learn why it matters. " +
    "At the end there is a question for you to think about.",
  "Stories like this one help you learn about the world. You can talk about them with your family " +
    "and your friends at school.",
];

const STUB_FILLER = "Reading a little every day helps you learn new things.";

/** The stub paragraphs, padded or trimmed to sit inside the configured word range. */
function stubBody(sourceName: string, range?: { min: number; max: number }): string[] {
  const body = STUB_PARAGRAPHS.map((p) => p.replace("{source}", sourceName));
  if (!range) return body;
  const count = () => countWords(body.join(" "));
  const target = Math.min(range.max, range.min + Math.ceil((range.max - range.min) / 4));
  while (count() < target) body[body.length - 1] += " " + STUB_FILLER;
  while (count() > range.max && body.length > 3) body.pop();
  return body;
}

/** Canned, deterministic replies built from the supplied context. No network, no key. */
export class StubLLM implements LLM {
  calls: string[] = [];

  async chat(_messages: ChatMessage[], { task, context = {}, onUsage }: ChatOptions): Promise<string> {
    this.calls.push(task);
    // Plausible token counts so a local stub run gives the dashboard something to show (cost 0).
    const tokens: Record<string, [number, number]> = { select: [6200, 450], rewrite: [2600, 700], check: [2300, 160] };
    const [input_tokens, output_tokens] = tokens[task] ?? [1000, 100];
    onUsage?.({ provider: "stub", model: "stub", input_tokens, output_tokens, stop_reason: "end_turn" });
    let out: unknown;
    if (task === "select") out = this.select(context);
    else if (task === "rewrite") out = this.rewrite(context);
    else if (task === "check") out = this.check(context);
    else throw new LLMError(`stub has no task ${JSON.stringify(task)}`);
    return "```json\n" + JSON.stringify(out) + "\n```";
  }

  select(ctx: Record<string, any>): unknown {
    const candidates: Candidate[] = ctx.candidates;
    const allowed: string[] = ctx.allowedTopics;
    const weights: Record<string, number> = ctx.weights ?? {};
    const count: number = ctx.storyCount;
    const nReserves: number = ctx.reserves ?? 4;
    const byTopic = new Map<string, Array<[Candidate, string]>>();
    for (const c of candidates) {
      const topic = c.topicHint && allowed.includes(c.topicHint) ? c.topicHint : stubGuessTopic(c.title, c.summary, allowed);
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic)!.push([c, topic]);
    }
    const order = [...byTopic.keys()].sort(
      (a, b) => -(weights[a] ?? 1) + (weights[b] ?? 1) || allowed.indexOf(a) - allowed.indexOf(b),
    );
    const ranked: Array<[Candidate, string]> = [];
    while (order.some((t) => byTopic.get(t)!.length)) {
      for (const t of order) {
        const list = byTopic.get(t)!;
        if (list.length) ranked.push(list.shift()!);
      }
    }
    const asJson = (pairs: Array<[Candidate, string]>) => pairs.map(([c, t]) => ({ candidate_id: c.id, topic: t }));
    return { picks: asJson(ranked.slice(0, count)), reserves: asJson(ranked.slice(count, count + nReserves)) };
  }

  rewrite(ctx: Record<string, any>): Record<string, any> {
    const cand: Candidate = ctx.candidate;
    return {
      title: cutText(cand.title, 45),
      teaser: cutText(`A practice story from ${cand.sourceName}.`, 60),
      topic: ctx.topic,
      body: stubBody(cand.sourceName, ctx.storyWords),
      word_to_know: { word: "practice", definition: "doing something again and again to get better at it" },
      think_about_it: "What would you like to find out about this story?",
      source_name: cand.sourceName,
      source_url: cand.url,
    };
  }

  check(_ctx: Record<string, any>): Record<string, any> {
    return { safe: true, supported: true, reasons: [] };
  }
}

// ---- Anthropic Messages API ----

/** The levels the dashboard offers (CONTRACT.md "AI settings"). */
export type Effort = "low" | "medium" | "high";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high"];
/**
 * Models that accept the server-side refusal fallback in its "default" form (beta
 * server-side-fallback-2026-07-01), per Anthropic's migration guide. Claude Haiku 5.5 has no
 * server-side fallback, so it is never sent there.
 */
export const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5"]);
export { DEFAULT_ANTHROPIC_MODEL };
/** The "default" scalar form of server-side refusal fallbacks needs exactly this beta header. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** The slice of the SDK client this provider uses, so tests can pass a mock. */
export interface AnthropicClientLike {
  beta: { messages: { create(params: any): Promise<any> } };
}

export interface AnthropicOptions {
  effort?: Effort;
  maxTokens?: number;
  retries?: number;
  retryDelayMs?: number;
  /** Per-request timeout for a client built from a key (default 10 minutes). */
  timeoutMs?: number;
}

/**
 * Claude via the Messages API (beta namespace, for server-side refusal fallbacks).
 *
 * Per Anthropic's Claude Opus 5.5 guidance: thinking is always on (adaptive), so no `thinking`,
 * `budget_tokens`, `temperature`, `top_p`, `top_k` or assistant prefill is sent; depth is set with
 * `output_config.effort`; JSON comes back schema-valid through `output_config.format`;
 * `stop_reason` is checked before reading content; refused requests are retried server-side
 * (`fallbacks: "default"`) and a refusal that survives that drops the candidate.
 */
export class AnthropicLLM implements LLM {
  private readonly effort: Effort;
  private readonly maxTokens: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly client: AnthropicClientLike, readonly model: string, opts: AnthropicOptions = {}) {
    this.effort = opts.effort ?? "medium";
    this.maxTokens = opts.maxTokens ?? 16000;
    this.retries = opts.retries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 2000;
  }

  static fromKey(apiKey: string, model: string, opts: AnthropicOptions = {}): AnthropicLLM {
    // Retries are ours (below), so the SDK's own are off to avoid multiplying them.
    return new AnthropicLLM(new Anthropic({ apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? 600_000 }), model, opts);
  }

  request(messages: ChatMessage[], opts: ChatOptions): Record<string, unknown> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
    const outputConfig: Record<string, unknown> = { effort: this.effort };
    if (opts.schema) outputConfig.format = { type: "json_schema", schema: opts.schema };
    return {
      model: this.model,
      max_tokens: this.maxTokens,
      ...(FALLBACK_MODELS.has(this.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" } : {}),
      ...(system ? { system } : {}),
      messages: turns,
      output_config: outputConfig,
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    if (!this.model) throw new LLMUnavailable("no model configured");
    const params = this.request(messages, opts);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await sleep(this.retryDelayMs * attempt);
      let resp: any;
      try {
        resp = await this.client.beta.messages.create(params);
      } catch (err) {
        // Most specific first. Retryable: 429, >=500 (incl. 529 overloaded), network.
        if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
          lastErr = err;
          console.warn(`Claude ${opts.task} got HTTP ${err.status} (attempt ${attempt + 1})`);
          continue;
        }
        if (err instanceof Anthropic.APIConnectionError) {
          lastErr = err;
          console.warn(`Claude ${opts.task} connection failed (attempt ${attempt + 1}): ${err.message}`);
          continue;
        }
        // 400 / 401 / 403 / 404 / 413: a configuration problem, not worth retrying.
        if (err instanceof Anthropic.APIError) throw new LLMUnavailable(`HTTP ${err.status}: ${err.message}`);
        throw err;
      }
      opts.log?.(usageLine(opts.task, resp));
      opts.onUsage?.(anthropicUsage(resp, this.model));
      if (resp.stop_reason === "refusal") {
        const d = resp.stop_details ?? null;
        throw new LLMRefusal(d?.category ?? null, d?.explanation ?? null);
      }
      if (resp.stop_reason === "max_tokens") {
        lastErr = new LLMError(`${opts.task}: reply cut off at max_tokens (${this.maxTokens})`);
        console.warn(`Claude ${opts.task} hit max_tokens (attempt ${attempt + 1})`);
        continue;
      }
      const text = (resp.content ?? [])
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("");
      if (!text) throw new LLMError(`${opts.task}: empty reply (stop_reason ${resp.stop_reason})`);
      return text;
    }
    if (lastErr instanceof LLMError) throw lastErr;
    throw new LLMUnavailable(`${opts.task}: ${String(lastErr)}`);
  }
}

/** Tokens for the attempt chain: per-attempt `usage.iterations` when a fallback ran, else top-level usage. */
function anthropicUsage(resp: any, requested: string): CallUsage {
  const u = resp?.usage ?? {};
  const its: any[] = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : [u];
  const sum = (k: string) => its.reduce((n, it) => n + (Number(it?.[k]) || 0), 0);
  return {
    provider: "anthropic",
    model: `anthropic:${typeof resp?.model === "string" && resp.model ? resp.model : requested}`,
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    stop_reason: resp?.stop_reason ?? null,
  };
}

function usageLine(task: string, resp: any): string {
  const u = resp?.usage ?? {};
  const fallback = (u.iterations ?? []).some((e: any) => e?.type === "fallback_message");
  const cache = u.cache_read_input_tokens ? ` cache_read=${u.cache_read_input_tokens}` : "";
  return `llm ${task}: model=${resp?.model} in=${u.input_tokens ?? "?"} out=${u.output_tokens ?? "?"}${cache} stop=${resp?.stop_reason}${fallback ? " (served by fallback)" : ""}`;
}

// ---- OpenRouter ----

export interface OpenRouterOptions {
  effort?: Effort;
  maxTokens?: number;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const OPENROUTER_CREDIT =
  "OpenRouter is out of credit (HTTP 402). Add credit at openrouter.ai, or choose an Anthropic model in the AI settings.";

/**
 * A model through OpenRouter's OpenAI-compatible chat API: strict JSON-schema response_format,
 * `reasoning: {effort}`, and `usage: {include: true}` so the reply carries its own cost.
 */
export class OpenRouterLLM implements LLM {
  readonly url = OPENROUTER_BASE_URL + "/chat/completions";
  private readonly effort: Effort;
  private readonly maxTokens: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly apiKey: string, readonly model: string, opts: OpenRouterOptions = {}) {
    this.effort = opts.effort ?? "medium";
    this.maxTokens = opts.maxTokens ?? 16000;
    this.retries = opts.retries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 600_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  body(messages: ChatMessage[], opts: ChatOptions): Record<string, unknown> {
    return {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: this.maxTokens,
      reasoning: { effort: this.effort },
      usage: { include: true },
      ...(opts.schema
        ? { response_format: { type: "json_schema", json_schema: { name: opts.task, strict: true, schema: opts.schema } } }
        : {}),
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-Title": "Early Edition Kids",
    };
    const body = JSON.stringify(this.body(messages, opts));
    let lastErr: unknown = null;
    let lengthRetried = false;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await sleep(this.retryDelayMs * attempt);
      let resp: Response;
      try {
        resp = await this.fetchImpl(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        lastErr = err;
        console.warn(`OpenRouter ${opts.task} call failed (attempt ${attempt + 1}): ${String(err)}`);
        continue;
      }
      const text = await resp.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      // OpenRouter can also report an error inside a 200 body.
      const status = resp.status >= 400 ? resp.status : Number(data?.error?.code) || (data?.error ? 500 : 200);
      if (status === 429 || status >= 500) {
        lastErr = new LLMUnavailable(`OpenRouter HTTP ${status}`);
        console.warn(`OpenRouter ${opts.task} got HTTP ${status} (attempt ${attempt + 1})`);
        continue;
      }
      if (status === 402) {
        opts.log?.(OPENROUTER_CREDIT);
        throw new LLMUnavailable(OPENROUTER_CREDIT);
      }
      if (status >= 400) {
        const msg = data?.error?.message ?? text.slice(0, 200);
        throw new LLMUnavailable(`OpenRouter HTTP ${status}: ${msg}`);
      }
      if (!data) throw new LLMError(`OpenRouter ${opts.task}: unreadable response ${JSON.stringify(text.slice(0, 200))}`);

      const choice = data.choices?.[0] ?? {};
      const finish = choice.finish_reason ?? choice.native_finish_reason ?? null;
      const usage = data.usage ?? {};
      const answered = typeof data.model === "string" && data.model ? data.model : this.model;
      const cost = typeof usage.cost === "number" ? usage.cost : undefined;
      opts.log?.(
        `llm ${opts.task}: model=openrouter:${answered} in=${usage.prompt_tokens ?? "?"} out=${usage.completion_tokens ?? "?"} stop=${finish}${cost !== undefined ? ` cost=$${cost}` : ""}`,
      );
      opts.onUsage?.({
        provider: "openrouter",
        model: `openrouter:${answered}`,
        input_tokens: Number(usage.prompt_tokens) || 0,
        output_tokens: Number(usage.completion_tokens) || 0,
        stop_reason: finish === "content_filter" || choice.message?.refusal ? "refusal" : finish,
        cost_usd: cost,
      });
      if (finish === "content_filter" || (typeof choice.message?.refusal === "string" && choice.message.refusal)) {
        throw new LLMRefusal(finish === "content_filter" ? "content_filter" : "refusal", choice.message?.refusal ?? null);
      }
      if (finish === "length") {
        lastErr = new LLMError(`${opts.task}: reply cut off at max_tokens (${this.maxTokens})`);
        if (lengthRetried) throw lastErr;
        lengthRetried = true;
        console.warn(`OpenRouter ${opts.task} hit the length limit; retrying once`);
        continue;
      }
      let content = choice.message?.content;
      if (Array.isArray(content)) content = content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
      if (typeof content !== "string" || !content) throw new LLMError(`${opts.task}: empty reply (finish_reason ${finish})`);
      return content;
    }
    if (lastErr instanceof LLMError) throw lastErr;
    throw new LLMUnavailable(`${opts.task}: ${String(lastErr)}`);
  }
}

// ---- provider selection ----

/** How the server talks to LLMs: the stub, the generic OpenAI-compatible endpoint, or the provider registry. */
export type Mode = "stub" | "openai" | "providers";

export function modeFor(settings: Settings): Mode {
  if (isStub(settings)) return "stub";
  const p = settings.llmProvider.trim().toLowerCase();
  if (p && !["anthropic", "openai", "openrouter"].includes(p)) {
    throw new LLMUnavailable(`LLM_PROVIDER must be anthropic, openrouter or openai, not ${JSON.stringify(settings.llmProvider)}`);
  }
  if (isLegacyOpenAI(settings)) return "openai";
  if (p || settings.llmApiKey || settings.openrouterApiKey) return "providers";
  throw new LLMUnavailable(
    "no LLM configured: set LLM_API_KEY (Anthropic) and/or OPENROUTER_API_KEY, or LLM_BASE_URL for an OpenAI-compatible endpoint",
  );
}

const asEffort = (v: string, fallback: Effort): Effort => {
  const e = v.trim().toLowerCase() as Effort;
  if (!e) return fallback;
  if (!EFFORTS.includes(e)) throw new LLMUnavailable(`effort must be one of ${EFFORTS.join(", ")}, not ${JSON.stringify(v)}`);
  return e;
};

export interface Clients {
  /** A mock Anthropic SDK client (tests). */
  anthropic?: AnthropicClientLike;
  /** A mock fetch for OpenRouter (tests). */
  openrouterFetch?: typeof fetch;
}

/** One client for a namespaced model id. Exported for the model comparison harness. */
export function clientFor(
  settings: Settings,
  id: string,
  effort: Effort,
  clients: Clients,
  tuning: { timeoutMs?: number; retries?: number } = {},
): LLM {
  const { provider, model } = splitModel(id, settings);
  if (provider === "anthropic") {
    if (clients.anthropic) return new AnthropicLLM(clients.anthropic, model, { effort, ...tuning });
    if (!settings.llmApiKey) throw new LLMUnavailable("LLM_API_KEY is not set, so Anthropic models can't be used");
    return AnthropicLLM.fromKey(settings.llmApiKey, model, { effort, ...tuning });
  }
  if (provider === "openrouter") {
    if (!settings.openrouterApiKey && !clients.openrouterFetch) {
      throw new LLMUnavailable("OPENROUTER_API_KEY is not set, so OpenRouter models can't be used");
    }
    return new OpenRouterLLM(settings.openrouterApiKey, model, { effort, fetchImpl: clients.openrouterFetch, ...tuning });
  }
  throw new LLMUnavailable(`no provider for model ${JSON.stringify(id)}`);
}

/**
 * (writer, checker). Each resolves its own namespaced model to a provider, so they can differ.
 * `settings.llmModel` / `checkLlmModel` / efforts are the effective AI settings (see aisettings.ts).
 */
export function buildLlms(settings: Settings, clients: Clients | AnthropicClientLike = {}): [LLM, LLM] {
  const c: Clients = "beta" in clients ? { anthropic: clients as AnthropicClientLike } : (clients as Clients);
  const mode = modeFor(settings);
  if (mode === "stub") return [new StubLLM(), new StubLLM()];
  if (mode === "openai") {
    if (!settings.llmBaseUrl) throw new LLMUnavailable("LLM_BASE_URL is not set");
    const writer = new OpenAICompatLLM(settings.llmBaseUrl, settings.llmApiKey, settings.llmModel);
    const checker = new OpenAICompatLLM(settings.llmBaseUrl, settings.llmApiKey, settings.checkLlmModel || settings.llmModel, {
      temperature: 0,
    });
    return [writer, checker];
  }
  const writerId = settings.llmModel || (settings.llmApiKey || c.anthropic || !settings.openrouterApiKey
    ? `anthropic:${DEFAULT_ANTHROPIC_MODEL}`
    : `openrouter:${"anthropic/claude-opus-5.5"}`);
  const checkId = settings.checkLlmModel || writerId;
  return [
    clientFor(settings, writerId, asEffort(settings.llmEffort, "medium"), c),
    clientFor(settings, checkId, asEffort(settings.checkLlmEffort, "high"), c),
  ];
}
