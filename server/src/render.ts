/**
 * Story HTML (DESIGN 4.8): standalone, no external assets, no scripts, no links. The Kindle can ask
 * for a version with the story's photo (CONTRACT.md "Story photos"); its `src` names a file the
 * Kindle keeps beside the page, so the page still loads nothing from the network.
 */

import nunjucks from "nunjucks";
import { loadsJson, type Row } from "./db.js";
import { TEMPLATES_DIR } from "./paths.js";
import { NUMBER, numberValue, type WordToKnow } from "./validate.js";
import { minutesFor } from "./weights.js";

export const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(TEMPLATES_DIR), {
  autoescape: true,
  trimBlocks: false,
});
env.addFilter("capitalize_first", (s: string) => (s ? s.slice(0, 1).toUpperCase() + s.slice(1) : s));

/** Escape &, < and > only (like Python's html.escape(quote=False)). */
export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Escape each paragraph and bold the first use of the word to know, as in the mockup. */
export function bodyToHtml(paragraphs: string[], wordToKnow: WordToKnow | null): string {
  const word = wordToKnow?.word ?? "";
  const pattern = word ? new RegExp(`(?<![\\p{L}\\p{N}_])(${reEscape(escapeText(word))})(?![\\p{L}\\p{N}_])`, "iu") : null;
  let done = false;
  return paragraphs
    .map((para) => {
      let html = escapeText(para);
      if (pattern && !done && pattern.test(html)) {
        html = html.replace(pattern, "<b>$1</b>");
        done = true;
      }
      return `<p>${html}</p>`;
    })
    .join("\n");
}

/**
 * What the parent dashboard marks in a story (CONTRACT.md "Story checks"). Only the dashboard
 * passes this: the story file, the Kindle and the iPad never get marks.
 */
export interface StoryMarks {
  /** The checked numbers to mark, as compared ('1300', not '1,300'). */
  numbers: Iterable<string>;
}

/**
 * Wrap each of `values` found in the text of an HTML fragment in
 * `<mark data-check="number" data-value="1300">1,300</mark>`. Tags and entities are left alone,
 * so the digits of `&#39;` are never taken for a number.
 */
export function markNumbers(html: string, values: ReadonlySet<string>): string {
  if (!values.size) return html;
  return html.replace(/<[^>]*>|&[#\w]+;|[^<&]+/g, (part) => {
    if (part.startsWith("<") || part.startsWith("&")) return part;
    return part.replace(NUMBER, (raw) => {
      const value = numberValue(raw);
      return values.has(value) ? `<mark data-check="number" data-value="${value}">${raw}</mark>` : raw;
    });
  });
}

/**
 * A story's stored paragraphs with the dashboard's marks: each checked number, and the bold first
 * use of the word to know as `<mark data-check="word"><b>word</b></mark>`. Taking the `<mark>` tags
 * out again gives back exactly what was passed in.
 */
export function markBody(bodyHtml: string, values: ReadonlySet<string>): string {
  // The only <b> in stored paragraphs is the word to know; numbers inside it are not marked twice.
  const m = /<b>[\s\S]*?<\/b>/.exec(bodyHtml);
  if (!m) return markNumbers(bodyHtml, values);
  const before = bodyHtml.slice(0, m.index);
  const after = bodyHtml.slice(m.index + m[0].length);
  return `${markNumbers(before, values)}<mark data-check="word">${m[0]}</mark>${markNumbers(after, values)}`;
}

export function parseWordToKnow(value: unknown): WordToKnow | null {
  const v = typeof value === "string" ? loadsJson<unknown>(value, null) : value;
  return v && typeof v === "object" && "word" in v ? (v as WordToKnow) : null;
}

/** A photo to put under the headline: `src` is relative to the page (a file beside it). */
export interface PagePhoto {
  src: string;
  alt: string | null;
}

/**
 * `story` is a stories row (or an object with the same keys). `marks` is for the parent dashboard
 * only: it marks the checked numbers in the headline and the paragraphs, and the word to know.
 * Without it the page is exactly what the Kindle and the iPad get.
 */
export function renderStory(story: Row, readingWpm: number, photo: PagePhoto | null = null, marks: StoryMarks | null = null): string {
  const values = marks ? new Set(marks.numbers) : null;
  const safe = (html: string) => new nunjucks.runtime.SafeString(html);
  const html = env.render("story.njk", {
    topic: story.topic,
    title: story.title,
    // Escaped by the template's own filter first, so the marked headline differs only by its marks.
    title_html: values ? safe(markNumbers(String(env.getFilter("escape")(String(story.title))), values)) : null,
    minutes: minutesFor(Number(story.word_count), readingWpm),
    body_html: safe(values ? markBody(story.body_html, values) : story.body_html),
    word_to_know: parseWordToKnow(story.word_to_know),
    think_about_it: story.think_about_it || "",
    source_name: story.source_name,
    photo,
  });
  // Match the original output: no trailing newline after </html>.
  return html.replace(/\n$/, "");
}
