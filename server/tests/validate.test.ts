import { describe, expect, it } from "vitest";
import { TOPIC_NAMES } from "../src/config.js";
import { checkNumbers, countWords, numberTokens, parseChecks, parseVerdict, unsupportedNumbers, validateStory } from "../src/validate.js";

const SOURCE_URL = "https://www.bbc.co.uk/newsround/articles/abc";
const SOURCE =
  "Harry Kane becomes England's most-capped male player. He won his 126th cap on 12 November " +
  "at Wembley, in front of 81,500 fans. England won 2-0. He has scored 3.5 goals in some games.";

const PARAS = [
  "Harry Kane has played for England more times than any other man. He did it on 12 November at Wembley.",
  "A huge crowd of 81,500 fans came to watch the game. They cheered and sang all through the match.",
  "England won the game 2-0. Kane was proud and thanked the fans for their support over the years.",
  "Kane is the England captain. He has played for the team for many years and scored lots of goals for his country " +
    "and for his clubs, and young players look up to him. Many children dream of being just like him one day.",
];

function goodStory(changes: Record<string, unknown> = {}) {
  return {
    title: "Kane makes England history",
    teaser: "The captain now has the most caps of any man.",
    topic: "Football",
    body: [...PARAS],
    word_to_know: { word: "cap", definition: "a game played for your country" },
    think_about_it: "Which 100 players would you pick for a dream team?",
    source_name: "BBC Newsround",
    source_url: SOURCE_URL,
    ...changes,
  };
}

const run = (story: unknown, blocklist = ["war", "killed"]) =>
  validateStory(story, { sourceText: SOURCE, sourceUrl: SOURCE_URL, allowedTopics: [...TOPIC_NAMES], blocklist });

describe("validation", () => {
  it("passes a good story", () => {
    const r = run(goodStory());
    expect(r.errors).toEqual([]);
    expect(countWords(r.story!.body.join(" "))).toBeGreaterThanOrEqual(100);
  });

  it("rejects a number absent from the source", () => {
    const body = [...PARAS];
    body[1] = "A huge crowd of 90,000 fans came to watch the game. They cheered and sang all through the match.";
    const r = run(goodStory({ body }));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("90000"))).toBe(true);
  });

  it("checks numbers in the title and teaser", () => {
    expect(run(goodStory({ title: "Kane wins 127th cap" })).ok).toBe(false);
    expect(run(goodStory({ teaser: "He played 200 games." })).ok).toBe(false);
    expect(run(goodStory({ title: "Kane wins 126th cap" })).ok).toBe(true);
  });

  it("exempts word_to_know and think_about_it from the number check", () => {
    // "100" in think_about_it and "1000" here are not in the source, and that is allowed.
    expect(run(goodStory({ word_to_know: { word: "cap", definition: "one of 1000 games" } })).ok).toBe(true);
  });

  it("strips commas when comparing numbers", () => {
    expect([...numberTokens("81,500 fans and 3.5 goals in 2026.")].sort()).toEqual(["2026", "3.5", "81500"]);
    expect(unsupportedNumbers("81500 people", SOURCE)).toEqual([]);
    expect(unsupportedNumbers("about 3.6 goals", SOURCE)).toEqual(["3.6"]);
  });

  it("reports the numbers it matched as well as the ones it could not", () => {
    expect(checkNumbers("In 2026, 81,500 fans saw 3.6 goals. 81500 again.", SOURCE)).toEqual([
      { value: "2026", in_source: false },
      { value: "81500", in_source: true },
      { value: "3.6", in_source: false },
    ]);
    // A passing story: the numbers of its title, teaser and body, in order of first use, all matched.
    const good = run(goodStory({ title: "Kane wins 126th cap" }));
    expect(good.ok).toBe(true);
    expect(good.numbers).toEqual([
      { value: "126", in_source: true },
      { value: "12", in_source: true },
      { value: "81500", in_source: true },
      { value: "2", in_source: true },
      { value: "0", in_source: true },
    ]);
    // A failing one still lists what matched; the boxes stay exempt.
    const bad = run(goodStory({ teaser: "He played 200 games." }));
    expect(bad.numbers).toContainEqual({ value: "200", in_source: false });
    expect(bad.numbers).toContainEqual({ value: "81500", in_source: true });
    expect(bad.numbers.map((n) => n.value)).not.toContain("100");
    expect(run("not a story").numbers).toEqual([]);
  });

  it("rejects a blocked word anywhere", () => {
    let body = [...PARAS];
    body[0] += " It was not a war.";
    expect(run(goodStory({ body })).errors.some((e) => e.includes("war"))).toBe(true);
    expect(run(goodStory({ think_about_it: "Who killed the time?" })).ok).toBe(false);
    // Substrings are fine.
    body = [...PARAS];
    body[0] += " The warm-up was great.";
    expect(run(goodStory({ body })).ok).toBe(true);
  });

  it.each([
    [{ title: "x".repeat(46) }, "title is 46"],
    [{ teaser: "y".repeat(61) }, "teaser is 61"],
    [{ topic: "Politics" }, "topic 'Politics'"],
    [{ source_url: "https://example.com/other" }, "source_url"],
    [{ body: PARAS.slice(0, 2) }, "paragraphs"],
    [{ body: PARAS.map((p) => p.slice(0, 40)) }, "words"],
    [{ think_about_it: "" }, "think_about_it"],
    [{ word_to_know: "cap" }, "word_to_know"],
  ])("enforces schema and limits %#", (change, fragment) => {
    const r = run(goodStory(change));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes(fragment))).toBe(true);
  });

  it("accepts the body as a string and a null word_to_know", () => {
    const r = run(goodStory({ body: PARAS.join("\n\n"), word_to_know: null }));
    expect(r.ok).toBe(true);
    expect(r.story!.body.length).toBe(4);
    expect(r.story!.word_to_know).toBeNull();
  });

  it("tolerates tracking params on source_url", () => {
    expect(run(goodStory({ source_url: SOURCE_URL + "?at_medium=RSS" })).ok).toBe(true);
  });

  it("counts words", () => {
    expect(countWords("Kane's 126th cap - at Wembley!")).toBe(5);
  });

  it("parses the checker verdict strictly", () => {
    expect(parseVerdict({ safe: true, supported: true, reasons: [] }).safe).toBe(true);
    const v = parseVerdict({ safe: "false", supported: "yes", reasons: "scary" });
    expect(v.safe).toBe(false);
    expect(v.supported).toBe(true);
    expect(v.reasons).toEqual(["scary"]);
    const e = parseVerdict({});
    expect(e.safe || e.supported).toBe(false);
  });

  it("reads stored checks back, and treats anything else as none", () => {
    const checks = {
      numbers: [{ value: "126", in_source: true }],
      verdict: { safe: true, supported: true, reasons: [] },
      attempts: 2,
      writer_model: "anthropic:claude-opus-5-5",
      checker_model: "anthropic:claude-sonnet-5-5",
    };
    expect(parseChecks(JSON.stringify(checks))).toEqual(checks);
    for (const none of [null, undefined, "", "not json", "[]", "{}", '{"numbers": "x", "verdict": {}}']) {
      expect(parseChecks(none)).toBeNull();
    }
    // Odd values inside a stored object are tidied rather than trusted.
    expect(parseChecks({ numbers: [{ value: "7" }, { value: 7 }, null], verdict: { safe: "yes" }, attempts: "3" })).toEqual({
      numbers: [{ value: "7", in_source: false }],
      verdict: { safe: true, supported: false, reasons: [] },
      attempts: 1,
      writer_model: null,
      checker_model: null,
    });
  });
});
