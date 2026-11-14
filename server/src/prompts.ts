/**
 * Prompt templates live in prompts/*.njk so the owner can tune them without code changes.
 *
 * Privacy (DESIGN 6): prompts receive the child's age, topic names, weights and favourite
 * players only. Nothing else about the child is ever passed in.
 */

import nunjucks from "nunjucks";
import type { ChatMessage } from "./llm.js";
import { PROMPTS_DIR } from "./paths.js";

const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(PROMPTS_DIR, { noCache: false }), {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: false,
});
env.addFilter("fixed", (v: number, digits = 2) => Number(v).toFixed(digits));

export function render(name: string, context: Record<string, unknown>): string {
  return env.render(name, context).trim();
}

/** Build [system, user] chat messages from <stem>_system.njk and <stem>_user.njk. */
export function messages(stem: string, context: Record<string, unknown>): ChatMessage[] {
  return [
    { role: "system", content: render(`${stem}_system.njk`, context) },
    { role: "user", content: render(`${stem}_user.njk`, context) },
  ];
}
