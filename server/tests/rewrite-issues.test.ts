import { afterEach, describe, expect, it } from "vitest";
import { rewriteIssues } from "../scripts/rewrite-issues.js";
import { StubLLM } from "../src/llm.js";
import { generate } from "../src/pipeline.js";
import { NOW, TODAY, fixturePageFetcher, makeCtx } from "./helpers.js";

let ctx: ReturnType<typeof makeCtx> | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

/** A stub writer whose stories are recognisably new. */
class NewWriter extends StubLLM {
  override rewrite(c: Record<string, any>) {
    return { ...super.rewrite(c), teaser: "Rewritten at the new length" };
  }
}

async function setup() {
  const c = makeCtx();
  await generate(c, TODAY, NOW);
  const v1 = c.db.storiesFor(TODAY, 1);
  c.db.run("UPDATE stories SET added_by = 'parent' WHERE id = ?", [v1[1].id]);
  c.db.run("UPDATE stories SET hidden = 1 WHERE id = ?", [v1[2].id]);
  c.db.run("UPDATE stories SET reused_from = ? WHERE id = ?", [v1[0].id, v1[3].id]);
  for (const s of v1) {
    c.db.run(
      "INSERT INTO events (device_id, client_event_id, story_id, type, ts, received_at, payload_json) VALUES ('d', ?, ?, 'story_opened', 0, '2026-11-14T07:00:00+00:00', '{}')",
      [`e-${s.id}`, s.id],
    );
  }
  // Story 5's page can no longer be read, so it fails and is carried over.
  const failUrl = v1[4].source_url;
  c.pageFetcher = async (url) => (url === failUrl ? "<html><body><p>Gone.</p></body></html>" : fixturePageFetcher(url));
  const writer = new NewWriter();
  c.writer = writer;
  c.checker = writer;
  return { c, v1: c.db.storiesFor(TODAY, 1), writer };
}

describe("rewrite-issues", () => {
  it("publishes a new version with the same order, flags kept, hidden dropped and a failed story carried over", async () => {
    const { c, v1, writer } = await setup();
    ctx = c;
    const events = JSON.stringify(c.db.query("SELECT * FROM events ORDER BY id"));
    const lines: string[] = [];
    const [res] = await rewriteIssues(c, { dates: [TODAY], now: NOW, log: (l) => lines.push(l) });
    expect(res).toMatchObject({ status: "rewritten", fromVersion: 1, toVersion: 2, rewritten: 4, carried: 1, dropped: 1 });

    const v2 = c.db.storiesFor(TODAY, 2);
    const visible = v1.filter((s) => !s.hidden);
    expect(v2.map((s) => s.position)).toEqual([1, 2, 3, 4, 5]);
    expect(v2.map((s) => s.source_url)).toEqual(visible.map((s) => s.source_url)); // same order, hidden one gone
    expect(v2.map((s) => s.topic)).toEqual(visible.map((s) => s.topic));
    expect(v2[1].added_by).toBe("parent");
    expect(v2[2].reused_from).toBe(v1[0].id);
    // The carried-over story is unchanged; the others are new.
    expect(v2[3]).toMatchObject({ title: v1[4].title, teaser: v1[4].teaser, body_html: v1[4].body_html });
    expect(v2.filter((s) => s.teaser === "Rewritten at the new length")).toHaveLength(4);
    for (const s of v2.filter((x) => x.teaser === "Rewritten at the new length")) {
      expect(s.word_count).toBeGreaterThanOrEqual(120); // config.example.yaml: 120 to 200
      expect(s.word_count).toBeLessThanOrEqual(200);
    }
    expect(c.db.getIssue(TODAY)!.version).toBe(2);
    expect(c.db.storiesFor(TODAY, 1)).toHaveLength(6); // old rows stay

    const run = c.db.queryOne("SELECT * FROM runs ORDER BY id DESC LIMIT 1")!;
    expect(run.status).toBe("created");
    expect(run.detail).toContain("rewrite at 120–200 words");
    expect(run.detail).toContain("failed, carried over unchanged #5");
    expect(run.detail).toContain("dropped hidden #3");
    const calls = c.db.query("SELECT stage FROM llm_calls WHERE run_id = ?", [run.id]);
    expect(calls.filter((x) => x.stage === "rewrite")).toHaveLength(4);
    expect(calls.filter((x) => x.stage === "check")).toHaveLength(4);
    expect(writer.calls.filter((x) => x === "select")).toHaveLength(0); // rewriting never selects

    expect(JSON.stringify(c.db.query("SELECT * FROM events ORDER BY id"))).toBe(events); // events untouched
  });

  it("makes no calls and writes nothing on a dry run", async () => {
    const { c, writer } = await setup();
    ctx = c;
    const before = c.db.queryOne("SELECT (SELECT COUNT(*) FROM stories) s, (SELECT COUNT(*) FROM runs) r, (SELECT COUNT(*) FROM llm_calls) l")!;
    const callsBefore = writer.calls.length;
    const lines: string[] = [];
    const [res] = await rewriteIssues(c, { dates: [TODAY], dryRun: true, log: (l) => lines.push(l) });
    expect(res).toMatchObject({ status: "dry-run", fromVersion: 1, toVersion: 2, dropped: 1 });
    expect(writer.calls.length).toBe(callsBefore);
    expect(c.db.queryOne("SELECT (SELECT COUNT(*) FROM stories) s, (SELECT COUNT(*) FROM runs) r, (SELECT COUNT(*) FROM llm_calls) l")).toEqual(before);
    expect(lines.join("\n")).toContain("plan: v1 -> v2, rewrite 5 stories at 120-200 words");
    expect(lines.join("\n")).toContain("(added by parent)");
  });

  it("refuses a date with a generation running, or with no issue", async () => {
    const { c, writer } = await setup();
    ctx = c;
    c.db.startRun(TODAY); // left "running"
    const callsBefore = writer.calls.length;
    const res = await rewriteIssues(c, { dates: [TODAY, "2026-11-01"], now: NOW, log: () => {} });
    expect(res.map((r) => [r.status, r.reason])).toEqual([
      ["refused", expect.stringContaining("a generation for this date is running")],
      ["refused", "no issue for this date"],
    ]);
    expect(writer.calls.length).toBe(callsBefore);
    expect(c.db.getIssue(TODAY)!.version).toBe(1);
  });

  it("carries the rest over unchanged once the budget would be passed", async () => {
    const { c } = await setup();
    ctx = c;
    const [res] = await rewriteIssues(c, { dates: [TODAY], now: NOW, budgetUsd: 0.05, log: () => {} });
    // The first story is estimated at $0.12, more than the budget, so nothing is rewritten and v1 stays.
    expect(res).toMatchObject({ status: "nothing", rewritten: 0, carried: 5 });
    expect(c.db.getIssue(TODAY)!.version).toBe(1);
  });
});
