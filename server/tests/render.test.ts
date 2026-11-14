import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyToHtml, renderStory } from "../src/render.js";
import { HERE } from "./helpers.js";

const SNAPSHOT = path.join(HERE, "snapshots", "story.html");

function sampleStory() {
  const wtk = { word: "ceremony", definition: "a special event held to celebrate something." };
  const body = [
    "England captain Harry Kane has won the Ballon d'Or. That is the golden ball trophy given to the best " +
      "footballer in the world each year.",
    "Kane was handed his prize at a big ceremony in London on 26 October. He is the first English player to win " +
      "it for 25 years. The last one was Michael Owen in 2001.",
    "Why did he win? Goals, goals, goals. Kane scored 61 times in 51 games for his club, Bayern Munich, " +
      "last season & fans <loved> it.",
  ];
  return {
    topic: "Football",
    title: "Harry Kane wins the Ballon d'Or",
    body_html: bodyToHtml(body, wtk),
    word_to_know: JSON.stringify(wtk),
    think_about_it: "Who do you think should win next year?",
    source_name: "BBC Sport",
    word_count: 135,
  };
}

describe("story HTML", () => {
  it("matches the snapshot byte for byte", () => {
    const html = renderStory(sampleStory(), 90);
    if (process.env.UPDATE_SNAPSHOTS || !existsSync(SNAPSHOT)) {
      mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
      writeFileSync(SNAPSHOT, html, "utf8");
    }
    expect(html).toBe(readFileSync(SNAPSHOT, "utf8"));
  });

  it("follows the rules", () => {
    const html = renderStory(sampleStory(), 90);
    expect(html).toContain("<title>Football · Harry Kane wins the Ballon d&#39;Or</title>");
    expect(html).toContain("FOOTBALL · 2 MINUTE READ");
    expect(html).toContain("<b>ceremony</b> in London"); // word to know bolded once in the body
    expect(html.split("<b>ceremony</b>").length - 1).toBe(1);
    expect(html).toContain("&amp; fans &lt;loved&gt; it"); // escaped
    for (const s of ["WORD TO KNOW", "THINK ABOUT IT", "Source: BBC Sport"]) expect(html).toContain(s);
    for (const banned of ["<script", "<a ", "<img", "<link", "http://", "https://", "@font-face", "display: flex", "grid"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("omits the word to know box when there is none", () => {
    const story = { ...sampleStory(), word_to_know: null, body_html: bodyToHtml(["One.", "Two.", "Three."], null) };
    const html = renderStory(story, 90);
    expect(html).not.toContain("WORD TO KNOW");
    expect(html).not.toContain("<b>");
  });
});
