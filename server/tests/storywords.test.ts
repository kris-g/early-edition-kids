import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { StubLLM, parseJsonObject } from "../src/llm.js";
import { rewritePromptContext } from "../src/pipeline.js";
import * as prompts from "../src/prompts.js";
import { countWords, validateStory } from "../src/validate.js";
import { NOW, exampleConfigData } from "./helpers.js";

const URL = "https://example.test/a";
/** Four paragraphs adding up to exactly `n` words. */
function body(n: number): string[] {
  const per = [Math.floor(n / 4), Math.floor(n / 4), Math.floor(n / 4)];
  per.push(n - per[0] * 3);
  return per.map((k) => Array.from({ length: k }, () => "word").join(" ") + ".");
}
const story = (n: number) => ({
  title: "A story",
  teaser: "A teaser",
  topic: "Science",
  body: body(n),
  word_to_know: null,
  think_about_it: "What do you think?",
  source_name: "BBC",
  source_url: URL,
});
const check = (n: number, words?: { min: number; max: number }) =>
  validateStory(story(n), { sourceText: "words", sourceUrl: URL, allowedTopics: ["Science"], blocklist: [], words });

describe("configurable story length", () => {
  it("validates at both bounds of a custom range", () => {
    const words = { min: 120, max: 200 };
    expect(countWords(story(120).body.join(" "))).toBe(120);
    expect(check(120, words).ok).toBe(true);
    expect(check(200, words).ok).toBe(true);
    expect(check(119, words).errors).toContain("body is 119 words; it needs 120 to 200");
    expect(check(201, words).errors).toContain("body is 201 words; it needs 120 to 200");
    // The default range is unchanged without config.
    expect(check(100).ok).toBe(true);
    expect(check(161).errors).toContain("body is 161 words; it needs 100 to 160");
  });

  it("reads story_words from config, defaulting to 100 to 160, and rejects a bad range", () => {
    const data = exampleConfigData();
    expect(parseConfig(data).storyWords).toEqual({ min: 120, max: 200 }); // config.example.yaml
    delete data.story_words;
    expect(parseConfig(data).storyWords).toEqual({ min: 100, max: 160 });
    expect(() => parseConfig({ ...data, story_words: { min: 200, max: 120 } })).toThrow();
  });

  it("tells the writer the configured range, and the stub writes inside it", async () => {
    const cfg = parseConfig({ ...exampleConfigData(), story_words: { min: 130, max: 190 } });
    const cand = { id: 1, title: "T", summary: "S", url: URL, sourceName: "BBC", kidsSource: false, topicHint: null, published: NOW, contentHtml: null };
    const msgs = prompts.messages("rewrite", { ...rewritePromptContext(cfg, cand, "Science", ["Science"], "Saturday 14 November 2026", "text"), problems: [] });
    expect(msgs[0].content).toContain("130 to 190 words in the body");
    expect(msgs[0].content).not.toContain("100 to 160");
    const reply = parseJsonObject(await new StubLLM().chat(msgs, { task: "rewrite", context: { candidate: cand, topic: "Science", storyWords: cfg.storyWords } }));
    const n = countWords(reply.body.join(" "));
    expect(n).toBeGreaterThanOrEqual(130);
    expect(n).toBeLessThanOrEqual(190);
  });
});
