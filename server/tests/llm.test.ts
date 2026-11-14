import { describe, expect, it } from "vitest";
import { LLMError, LLMUnavailable, OpenAICompatLLM, StubLLM, parseJsonObject } from "../src/llm.js";

describe("parseJsonObject", () => {
  it.each([
    '{"a": 1, "b": {"c": "}"}}',
    '```json\n{"a": 1, "b": {"c": "}"}}\n```',
    'Sure! Here is the JSON:\n```\n{"a": 1, "b": {"c": "}"}}\n```\nHope that helps.',
    'Here you go: {"a": 1, "b": {"c": "}"}} -- done',
    '<think>maybe {"x": 0}</think>\n{"a": 1, "b": {"c": "}"}}',
    '{"a": 1, "b": {"c": "}"},}',
  ])("parses defensively %#", (text) => {
    expect(parseJsonObject(text)).toEqual({ a: 1, b: { c: "}" } });
  });

  it("rejects non-objects", () => {
    expect(() => parseJsonObject("no json here")).toThrow(LLMError);
    expect(() => parseJsonObject("[1, 2, 3]")).toThrow(LLMError);
  });
});

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;
const client = (handler: Handler) =>
  new OpenAICompatLLM("http://llm.test/v1", "secret", "model-x", {
    retries: 1,
    retryDelayMs: 0,
    fetchImpl: (async (url: any, init: any) => handler(String(url), init)) as typeof fetch,
  });

describe("OpenAICompatLLM", () => {
  it("sends a standard request", async () => {
    const seen: Record<string, any> = {};
    const llm = client((url, init) => {
      seen.url = url;
      seen.auth = (init.headers as Record<string, string>).Authorization;
      seen.body = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: '```json\n{"ok": true}\n```' } }] });
    });
    const reply = await llm.chat([{ role: "user", content: "hi" }], { task: "select" });
    expect(parseJsonObject(reply)).toEqual({ ok: true });
    expect(seen.url).toBe("http://llm.test/v1/chat/completions");
    expect(seen.auth).toBe("Bearer secret");
    expect(seen.body.model).toBe("model-x");
    expect("response_format" in seen.body).toBe(false);
  });

  it("is unavailable on a network error", async () => {
    const llm = client(() => {
      throw new TypeError("fetch failed: connection refused");
    });
    await expect(llm.chat([], { task: "select" })).rejects.toBeInstanceOf(LLMUnavailable);
  });

  it("retries a 5xx", async () => {
    let calls = 0;
    const llm = client(() => {
      calls++;
      return calls === 1 ? new Response("", { status: 503 }) : Response.json({ choices: [{ message: { content: "{}" } }] });
    });
    expect(await llm.chat([], { task: "check" })).toBe("{}");
    expect(calls).toBe(2);
  });
});

describe("StubLLM", () => {
  it("returns a canned check", async () => {
    const reply = await new StubLLM().chat([], { task: "check", context: {} });
    expect(parseJsonObject(reply)).toEqual({ safe: true, supported: true, reasons: [] });
  });
});
