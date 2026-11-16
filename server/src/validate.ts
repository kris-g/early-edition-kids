/** Mechanical validation of a rewritten story (DESIGN 4.3) and checker verdict parsing. */

import { blocklistHits, compileBlocklist, normaliseUrl } from "./feeds.js";

export const TITLE_MAX = 45;
export const TEASER_MAX = 60;
export const WORDS_MIN = 100;
export const WORDS_MAX = 160;
export const PARAS_MIN = 3;
export const PARAS_MAX = 5;
export const WORD_TO_KNOW_MAX = 40;
export const DEFINITION_MAX = 160;
export const THINK_MAX = 200;

const NUMBER = /\d+(?:[.,]\d+)*/g;
const WORD = /[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g;

export interface WordToKnow {
  word: string;
  definition: string;
}

export interface Story {
  title: string;
  teaser: string;
  topic: string;
  body: string[];
  word_to_know: WordToKnow | null;
  think_about_it: string;
  source_name: string;
  source_url: string;
}

/** One number found in a story's title, teaser or body, and whether the source text has it too. */
export interface NumberCheck {
  /** Digits with thousands commas stripped, as compared: '1300', '3.8'. */
  value: string;
  in_source: boolean;
}

export interface ValidationResult {
  story: Story | null;
  errors: string[];
  ok: boolean;
  /** Every number in the title, teaser and body, in order of first use (empty when there is no story). */
  numbers: NumberCheck[];
}

export function countWords(text: string): number {
  return (text.match(WORD) ?? []).length;
}

export const storyWordCount = (s: Story) => countWords(s.body.join(" "));

/** Digit sequences with thousands commas stripped: '1,300' -> '1300', '3.8' stays '3.8'. */
export function numberTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text || "").match(NUMBER) ?? []) out.add(raw.replace(/,/g, "").replace(/\.+$/, ""));
  return out;
}

/** Every number in the story text, in order of first use, with whether the source text has it. */
export function checkNumbers(storyText: string, sourceText: string): NumberCheck[] {
  const source = numberTokens(sourceText);
  return [...numberTokens(storyText)].map((value) => ({ value, in_source: source.has(value) }));
}

export function unsupportedNumbers(storyText: string, sourceText: string): string[] {
  return checkNumbers(storyText, sourceText)
    .filter((n) => !n.in_source)
    .map((n) => n.value)
    .sort();
}

/** The text the number check reads: title, teaser and body (DESIGN 4.3; the boxes are exempt). */
export const checkedText = (story: Pick<Story, "title" | "teaser" | "body">) => [story.title, story.teaser, ...story.body].join(" ");

const clean = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

export function coerceStory(data: unknown): { story: Story | null; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(data)) return { story: null, errors: ["reply is not a JSON object"] };

  let body: unknown = data.body;
  if (typeof body === "string") body = body.split(/\n\s*\n/).filter((p) => p.trim());
  if (!Array.isArray(body) || !body.every((p) => typeof p === "string")) {
    errors.push("body must be a list of paragraph strings");
    body = [];
  }
  const paras = (body as string[]).map(clean).filter(Boolean);

  let wtk: unknown = data.word_to_know;
  let wordToKnow: WordToKnow | null = null;
  if (wtk === null || wtk === undefined || wtk === "" || (isObj(wtk) && Object.keys(wtk).length === 0)) {
    wordToKnow = null;
  } else if (isObj(wtk) && clean(wtk.word) && clean(wtk.definition)) {
    wordToKnow = { word: clean(wtk.word), definition: clean(wtk.definition) };
  } else {
    errors.push("word_to_know must be null or {word, definition}");
  }

  for (const key of ["title", "teaser", "topic", "think_about_it", "source_name", "source_url"]) {
    if (typeof data[key] !== "string" || !clean(data[key])) errors.push(`${key} is missing`);
  }

  return {
    story: {
      title: clean(data.title),
      teaser: clean(data.teaser),
      topic: clean(data.topic),
      body: paras,
      word_to_know: wordToKnow,
      think_about_it: clean(data.think_about_it),
      source_name: clean(data.source_name),
      source_url: clean(data.source_url),
    },
    errors,
  };
}

export function validateStory(
  data: unknown,
  opts: {
    sourceText: string;
    sourceUrl: string;
    allowedTopics: string[];
    blocklist: readonly string[];
    /** Body length range; defaults to WORDS_MIN to WORDS_MAX. */
    words?: { min: number; max: number };
  },
): ValidationResult {
  const wordsMin = opts.words?.min ?? WORDS_MIN;
  const wordsMax = opts.words?.max ?? WORDS_MAX;
  const { story, errors } = coerceStory(data);
  if (!story) return { story: null, errors, ok: false, numbers: [] };

  if (story.title.length > TITLE_MAX) errors.push(`title is ${story.title.length} characters; the limit is ${TITLE_MAX}`);
  if (story.teaser.length > TEASER_MAX) errors.push(`teaser is ${story.teaser.length} characters; the limit is ${TEASER_MAX}`);
  if (!opts.allowedTopics.includes(story.topic)) {
    errors.push(`topic '${story.topic}' is not one of: ${opts.allowedTopics.join(", ")}`);
  }
  if (story.body.length < PARAS_MIN || story.body.length > PARAS_MAX) {
    errors.push(`body has ${story.body.length} paragraphs; it needs ${PARAS_MIN} to ${PARAS_MAX}`);
  }
  const words = storyWordCount(story);
  if (words < wordsMin || words > wordsMax) errors.push(`body is ${words} words; it needs ${wordsMin} to ${wordsMax}`);
  if (
    story.word_to_know &&
    (story.word_to_know.word.length > WORD_TO_KNOW_MAX || story.word_to_know.definition.length > DEFINITION_MAX)
  ) {
    errors.push("word_to_know is too long");
  }
  if (story.think_about_it.length > THINK_MAX) errors.push("think_about_it is too long");
  if (normaliseUrl(story.source_url) !== normaliseUrl(opts.sourceUrl)) {
    errors.push(`source_url must be exactly ${opts.sourceUrl}`);
  }

  const text = checkedText(story);
  const numbers = checkNumbers(text, opts.sourceText);
  const missing = numbers.filter((n) => !n.in_source).map((n) => n.value).sort();
  if (missing.length) {
    errors.push(`these numbers are not in the source text: ${missing.join(", ")}. Use only numbers from the source`);
  }

  const pattern = compileBlocklist(opts.blocklist);
  if (pattern) {
    const wtkText = story.word_to_know ? `${story.word_to_know.word} ${story.word_to_know.definition}` : "";
    const hits = [...new Set(blocklistHits(pattern, [text, wtkText, story.think_about_it].join(" ")).map((h) => h.toLowerCase()))].sort();
    if (hits.length) errors.push(`uses blocked words: ${hits.join(", ")}`);
  }

  return { story, errors, ok: errors.length === 0, numbers };
}

export interface Verdict {
  safe: boolean;
  supported: boolean;
  reasons: string[];
}

/**
 * What the pipeline found when it checked a story, kept with the story (stories.checks, as JSON)
 * so the dashboard can show it. Stories made before migration 5 have none.
 */
export interface StoryChecks {
  numbers: NumberCheck[];
  /** The checker's verdict on the version that was published. */
  verdict: Verdict;
  /** How many rewrites it took: 1, or 2 when the first was sent back. */
  attempts: number;
  /** The models that answered, namespaced as in llm_calls ("anthropic:claude-opus-5-5", "stub"). */
  writer_model: string | null;
  checker_model: string | null;
}

/** Stored checks read back defensively: anything that is not the shape above is null. */
export function parseChecks(value: unknown): StoryChecks | null {
  let v: unknown = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || !Array.isArray(v.numbers) || !isObj(v.verdict)) return null;
  const model = (m: unknown) => (typeof m === "string" && m ? m : null);
  return {
    numbers: v.numbers
      .filter((n): n is Record<string, any> => isObj(n) && typeof n.value === "string" && n.value !== "")
      .map((n) => ({ value: n.value, in_source: n.in_source === true })),
    verdict: parseVerdict(v.verdict),
    attempts: Number.isInteger(v.attempts) && v.attempts > 0 ? v.attempts : 1,
    writer_model: model(v.writer_model),
    checker_model: model(v.checker_model),
  };
}

const truthy = (v: unknown) =>
  typeof v === "boolean" ? v : typeof v === "string" ? ["true", "yes"].includes(v.trim().toLowerCase()) : false;

/** Missing or odd values count as a failure: the checker must say yes explicitly. */
export function parseVerdict(data: unknown): Verdict {
  if (!isObj(data)) return { safe: false, supported: false, reasons: [] };
  let reasons: unknown = data.reasons;
  if (typeof reasons === "string") reasons = [reasons];
  if (!Array.isArray(reasons)) reasons = [];
  return {
    safe: truthy(data.safe),
    supported: truthy(data.supported),
    reasons: (reasons as unknown[]).filter(Boolean).map(String),
  };
}
