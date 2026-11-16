import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bodyToHtml, markNumbers, renderStory } from "../src/render.js";
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

  const unmarked = (html: string) => html.replace(/<\/?mark[^>]*>/g, "");

  it("marks checked numbers and the word to know only when asked, and changes nothing else", () => {
    const plain = renderStory(sampleStory(), 90);
    expect(plain).not.toContain("<mark");
    expect(renderStory(sampleStory(), 90, null, null)).toBe(plain);

    // 2 and 39 are "checked" too, to show what must never be marked: the reading time and an entity.
    const marked = renderStory(sampleStory(), 90, null, { numbers: ["26", "25", "2001", "61", "51", "2", "39"] });
    expect(marked).toContain('on <mark data-check="number" data-value="26">26</mark> October');
    expect(marked).toContain('<mark data-check="number" data-value="61">61</mark> times in <mark data-check="number" data-value="51">51</mark> games');
    expect(marked).toContain('<mark data-check="word"><b>ceremony</b></mark> in London');
    expect(marked.split("<mark").length - 1).toBe(6); // five numbers and the word
    expect(marked).toContain("FOOTBALL · 2 MINUTE READ");
    expect(marked).toContain("<h1>Harry Kane wins the Ballon d&#39;Or</h1>");
    expect(marked).toContain("<title>Football · Harry Kane wins the Ballon d&#39;Or</title>");
    // Take the marks out and it is the Kindle's page, byte for byte.
    expect(unmarked(marked)).toBe(plain);
    expect(plain).toBe(readFileSync(SNAPSHOT, "utf8"));
  });

  it("marks numbers in the headline, never in the boxes or a number that was not checked", () => {
    const story = { ...sampleStory(), title: "Kane's 61 goals win it", think_about_it: "Could you score 61 goals?" };
    const marked = renderStory(story, 90, null, { numbers: ["61"] });
    expect(marked).toContain('<h1>Kane&#39;s <mark data-check="number" data-value="61">61</mark> goals win it</h1>');
    expect(marked).toContain("<title>Football · Kane&#39;s 61 goals win it</title>");
    expect(marked).toContain("<p>Could you score 61 goals?</p>");
    expect(marked).toContain("in 51 games"); // not in the list
    expect(unmarked(marked)).toBe(renderStory(story, 90));
  });

  it("matches numbers as the check compares them", () => {
    const values = new Set(["1300", "3.8"]);
    expect(markNumbers("More than 1,300 pupils, 3.8 each, 13 late.", values)).toBe(
      'More than <mark data-check="number" data-value="1300">1,300</mark> pupils, <mark data-check="number" data-value="3.8">3.8</mark> each, 13 late.',
    );
    expect(markNumbers("<p>1300 &amp; &#1300; <b>1,300</b></p>", values)).toBe(
      '<p><mark data-check="number" data-value="1300">1300</mark> &amp; &#1300; <b><mark data-check="number" data-value="1300">1,300</mark></b></p>',
    );
    expect(markNumbers("1,300", new Set())).toBe("1,300");
  });

  it("omits the word to know box when there is none", () => {
    const story = { ...sampleStory(), word_to_know: null, body_html: bodyToHtml(["One.", "Two.", "Three."], null) };
    const html = renderStory(story, 90);
    expect(html).not.toContain("WORD TO KNOW");
    expect(html).not.toContain("<b>");
  });
});
