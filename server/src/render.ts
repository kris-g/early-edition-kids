/**
 * Story HTML (DESIGN 4.8): standalone, no external assets, no scripts, no links. The Kindle can ask
 * for a version with the story's photo (CONTRACT.md "Story photos"); its `src` names a file the
 * Kindle keeps beside the page, so the page still loads nothing from the network.
 */

import nunjucks from "nunjucks";
import { loadsJson, type Row } from "./db.js";
import { TEMPLATES_DIR } from "./paths.js";
import type { WordToKnow } from "./validate.js";
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

export function parseWordToKnow(value: unknown): WordToKnow | null {
  const v = typeof value === "string" ? loadsJson<unknown>(value, null) : value;
  return v && typeof v === "object" && "word" in v ? (v as WordToKnow) : null;
}

/** A photo to put under the headline: `src` is relative to the page (a file beside it). */
export interface PagePhoto {
  src: string;
  alt: string | null;
}

/** `story` is a stories row (or an object with the same keys). */
export function renderStory(story: Row, readingWpm: number, photo: PagePhoto | null = null): string {
  const html = env.render("story.njk", {
    topic: story.topic,
    title: story.title,
    minutes: minutesFor(Number(story.word_count), readingWpm),
    body_html: new nunjucks.runtime.SafeString(story.body_html),
    word_to_know: parseWordToKnow(story.word_to_know),
    think_about_it: story.think_about_it || "",
    source_name: story.source_name,
    photo,
  });
  // Match the original output: no trailing newline after </html>.
  return html.replace(/\n$/, "");
}
