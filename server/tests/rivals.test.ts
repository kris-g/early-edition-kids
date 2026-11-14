import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { checkMessages, rewritePromptContext } from "../src/pipeline.js";
import * as prompts from "../src/prompts.js";

const text = (msgs: Array<{ content: unknown }>) =>
  msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

const cand = { title: "Arsenal lose at home", summary: "", url: "https://example.test/a", sourceName: "BBC Sport", published: new Date() } as never;
const story = { title: "t", teaser: "t", topic: "Football", body: ["b"], word_to_know: null, think_about_it: "q" } as never;

describe("favourite team and rival clubs", () => {
  it("reads favourite_team and rival_clubs from config", () => {
    const cfg = loadConfig("config.example.yaml");
    expect(cfg.favouriteTeam).toBe("Liverpool");
    expect(cfg.rivalClubs).toEqual(["Arsenal", "Manchester United", "Manchester City", "Real Madrid", "Barcelona"]);
    expect(cfg.favouritePlayers).toContain("Lamine Yamal");
  });

  it("puts the rivalry rule in both the writer's and the checker's prompts", () => {
    const cfg = loadConfig("config.example.yaml");
    const rewrite = text(prompts.messages("rewrite", rewritePromptContext(cfg, cand, "Football", cfg.topics.map((t) => t.name), "Saturday 14 November", "x")) as never);
    const check = text(checkMessages(cfg, cand, "x", story) as never);
    for (const t of [rewrite, check]) {
      expect(t).toContain("RIVALS: the reader supports Liverpool.");
      expect(t).toContain("never insult or mock players");
      expect(t).toContain("a checker must not reject a story for it");
    }
  });

  it("leaves the rule out when no rivals are configured", () => {
    const cfg = { ...loadConfig("config.example.yaml"), rivalClubs: [] };
    const rewrite = text(prompts.messages("rewrite", rewritePromptContext(cfg, cand, "Football", cfg.topics.map((t) => t.name), "Saturday 14 November", "x")) as never);
    expect(rewrite).not.toContain("RIVALS:");
  });

  it("allows manager sackings as plain news", () => {
    const cfg = loadConfig("config.example.yaml");
    expect(text(checkMessages(cfg, cand, "x", story) as never)).toContain("A manager leaving or being sacked is fine as plain news");
  });
});

describe("dates in older stories", () => {
  it("tells the checker today's date and the publication date, and that stale weekdays are not supported", () => {
    const cfg = loadConfig("config.example.yaml");
    const old = { ...(cand as object), published: new Date("2026-10-27T09:00:00Z") } as never;
    const t = text(checkMessages(cfg, old, "x", story, "Saturday 14 November 2026") as never);
    expect(t).toContain("Today is Saturday 14 November 2026. The source was published on Tuesday 27 October 2026.");
    expect(t).toContain("A bare weekday");
  });
  it("tells the writer to drop a weekday from older sources", () => {
    const cfg = loadConfig("config.example.yaml");
    const t = text(prompts.messages("rewrite", rewritePromptContext(cfg, cand, "Football", cfg.topics.map((x) => x.name), "Saturday 14 November", "x")) as never);
    expect(t).toContain("so older news never sounds like this week");
  });
});

describe("men's football only", () => {
  it("tells every prompt to skip women's and girls' football", () => {
    const cfg = loadConfig("config.example.yaml");
    const check = text(checkMessages(cfg, cand, "x", story) as never);
    expect(check).toContain("football means men's football only");
    const rewrite = prompts.messages("rewrite", rewritePromptContext(cfg, cand, "Football", ["Football"], "today", "x"));
    expect(text(rewrite as never)).toContain("football means men's football only");
  });
  it("leaves the rule out when mens_football_only is off", () => {
    const cfg = { ...loadConfig("config.example.yaml"), mensFootballOnly: false };
    const check = text(checkMessages(cfg, cand, "x", story) as never);
    expect(check).not.toContain("men's football only");
    expect(check).toContain("Keep sports stories on the sport itself");
  });
  it("drops women's football headlines from the football feeds before selection", () => {
    const cfg = loadConfig("config.example.yaml");
    const feeds = cfg.feeds.filter((f) => /BBC Sport/.test(f.name));
    expect(feeds.map((f) => f.name)).toEqual(expect.arrayContaining(["BBC Sport football", "BBC Sport Liverpool", "BBC Sport England"]));
    for (const f of feeds) {
      const hit = (t: string) => f.excludeTitlePatterns.some((p) => new RegExp(p, "i").test(t));
      expect(hit("Arsenal draw in Women's Champions League")).toBe(true);
      expect(hit("Lionesses name squad for Spain")).toBe(true);
      expect(hit("WSL: Chelsea beat City")).toBe(true);
      expect(hit("Liverpool score three at Crystal Palace")).toBe(false);
    }
  });
});
