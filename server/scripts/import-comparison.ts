/**
 * Import the Claude Opus 5.5 stories from model-comparison reports into the live database, as if
 * the pipeline had published them on those days, without spending tokens again.
 *
 *   tsx scripts/import-comparison.ts [--dry-run] [--profile younger] reports/model-comparison-2026-11-09.json ...
 *
 * With several profiles, --profile picks the child (default: the profile that owns the root data).
 *
 * Per day (oldest first): only Opus stories that passed the automatic checks AND the checker;
 * skip any whose normalised source URL or title is already in an issue within 14 days either side
 * or was imported on an earlier day; positions in the selector's order; version 1, not a fallback;
 * created at 05:31 Europe/London. A date that already has an issue is refused, so running twice
 * inserts nothing. The Opus calls behind the day (select, rewrites, and checks on Opus's stories,
 * including stories that failed) are recorded in llm_calls against one run per day.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dbPath, settingsFromEnv, type Config, type Settings } from "../src/config.js";
import { profileFromArgs } from "../src/profiles.js";
import { Database } from "../src/db.js";
import { normaliseTitle, normaliseUrl } from "../src/feeds.js";
import { StubLLM } from "../src/llm.js";
import { buildContext, draftRow, storeIssue, type Context, type StoryRow } from "../src/pipeline.js";
import { addDays, generationNow } from "../src/timeutil.js";
import { markOutcome, recordCall, type CallUsage, type Stage } from "../src/usage.js";
import type { Story } from "../src/validate.js";

export const WRITER = "anthropic:claude-opus-5-5";
const DEDUPE_DAYS = 14;

/** 05:31 Europe/London on `date` (06:00 London, the reference time of a run for a past date, less 29 minutes). */
export function importTime(date: string): Date {
  return new Date(generationNow(date, new Date(0)).getTime() - 29 * 60_000);
}

interface PlannedStory {
  position: number;
  candidate_id: number;
  title: string;
  source_title: string;
  source_url: string;
  row: StoryRow;
}

interface PlannedCall {
  stage: Stage;
  label: string;
  usage: CallUsage;
  outcome?: "pass" | "sent_back";
}

export interface DayPlan {
  date: string;
  file: string;
  refused: string | null;
  at: Date;
  seconds: number;
  stories: PlannedStory[];
  skipped: { title: string; reason: string }[];
  failed: { title: string; reasons: string[] }[];
  calls: PlannedCall[];
  cost_usd: number;
}

const isClean = (r: any) =>
  Boolean(r?.story && r.validation?.ok && r.checker && !r.checker.error && r.checker.safe && r.checker.supported);

function toUsage(u: any): CallUsage {
  return {
    provider: "anthropic",
    model: (u?.models_answered?.[0] as string) || WRITER,
    input_tokens: Number(u?.input_tokens) || 0,
    output_tokens: Number(u?.output_tokens) || 0,
    stop_reason: u?.stop_reason ?? null,
    cost_usd: Number(u?.cost_usd) || 0,
  };
}

/** Work out what would be inserted and skipped. Reads the database; writes nothing. */
export function planImport(db: Database, reports: { file: string; data: any }[]): DayPlan[] {
  const sorted = [...reports].sort((a, b) => String(a.data.meta.date).localeCompare(String(b.data.meta.date)));
  const dates = sorted.map((r) => r.data.meta.date as string);
  // Stories already in live issues near these dates (Friday's live issue included).
  const seenUrl = new Map<string, string>();
  const seenTitle = new Map<string, string>();
  if (dates.length) {
    for (const s of db.query("SELECT issue_date, source_url, source_title FROM stories WHERE issue_date BETWEEN ? AND ?", [
      addDays(dates[0], -DEDUPE_DAYS),
      addDays(dates.at(-1)!, DEDUPE_DAYS),
    ])) {
      seenUrl.set(normaliseUrl(s.source_url), `already in the ${s.issue_date} issue`);
      if (s.source_title) seenTitle.set(normaliseTitle(s.source_title), `already in the ${s.issue_date} issue`);
    }
  }

  return sorted.map(({ file, data }) => {
    const date: string = data.meta.date;
    const plan: DayPlan = { date, file, refused: null, at: importTime(date), seconds: 0, stories: [], skipped: [], failed: [], calls: [], cost_usd: 0 };
    if (db.getIssue(date)) {
      plan.refused = `${date} already has an issue; nothing imported for this day`;
      return plan;
    }
    if (!data.selection?.[WRITER] || !Object.keys(data.totals ?? {}).includes(WRITER)) {
      plan.refused = `the report has no ${WRITER} results`;
      return plan;
    }
    const sel = data.selection[WRITER];
    plan.calls.push({ stage: "select", label: "select", usage: toUsage(sel) });
    plan.seconds += Number(sel.seconds) || 0;

    for (const s of data.stories as any[]) {
      const r = s.results?.[WRITER];
      if (!r) continue;
      const url = normaliseUrl(s.source_url);
      const ntitle = normaliseTitle(s.source_title);
      const dupe = seenUrl.get(url) ?? seenTitle.get(ntitle);
      if (dupe) {
        // The pipeline would never have written this one, so its calls are not recorded either.
        plan.skipped.push({ title: s.source_title, reason: `duplicate: ${dupe}` });
        continue;
      }
      if (r.writer_usage) plan.calls.push({ stage: "rewrite", label: `rewrite [${s.candidate_id}]`, usage: toUsage(r.writer_usage) });
      plan.seconds += Number(r.seconds) || 0;
      if (r.checker?.usage) {
        plan.calls.push({
          stage: "check",
          label: `check [${s.candidate_id}]`,
          usage: toUsage(r.checker.usage),
          outcome: r.checker.safe && r.checker.supported && !r.checker.error ? "pass" : "sent_back",
        });
        plan.seconds += Number(r.checker.seconds) || 0;
      }
      if (!isClean(r)) {
        const reasons = [...(r.validation?.reasons ?? []), ...(r.checker?.reasons ?? []), ...(r.error ? [r.error] : [])];
        plan.failed.push({ title: s.source_title, reasons: reasons.length ? reasons : ["did not pass"] });
        continue;
      }
      const story: Story = { ...r.story, source_name: s.source_name, source_url: url };
      const row = draftRow({
        story,
        candidate: {
          id: s.candidate_id,
          title: s.source_title,
          summary: "",
          url,
          sourceName: s.source_name,
          kidsSource: false,
          topicHint: null,
          published: plan.at,
          contentHtml: null,
        },
        sourceText: "",
        addedBy: null,
        requestId: null,
      });
      plan.stories.push({ position: plan.stories.length + 1, candidate_id: s.candidate_id, title: r.story.title, source_title: s.source_title, source_url: url, row });
      seenUrl.set(url, `imported for ${date}`);
      seenTitle.set(ntitle, `imported for ${date}`);
    }
    plan.cost_usd = plan.calls.reduce((n, c) => n + (c.usage.cost_usd ?? 0), 0);
    plan.seconds = Math.round(plan.seconds);
    return plan;
  });
}

function runDetail(plan: DayPlan, data: any): string[] {
  const lines = [
    `run for ${plan.date}: imported from the model comparison report (${path.basename(plan.file)}, generated ${data.meta.generated_at}); no tokens spent on import`,
    `ai: writer ${WRITER} (medium), checker ${data.meta.checker} (high); ${data.meta.candidates} candidates`,
    ...plan.calls.map((c) => `llm ${c.label}: model=${c.usage.model} in=${c.usage.input_tokens} out=${c.usage.output_tokens} stop=${c.usage.stop_reason} cost=$${(c.usage.cost_usd ?? 0).toFixed(6)}`),
    ...plan.stories.map((s) => `[${s.candidate_id}] imported as #${s.position}: ${JSON.stringify(s.title)}`),
    ...plan.skipped.map((s) => `skipped ${JSON.stringify(s.title)}: ${s.reason}`),
    ...plan.failed.map((s) => `not imported (did not pass first time) ${JSON.stringify(s.title)}: ${s.reasons.join("; ")}`),
    `published ${plan.stories.length} stories as v1 (imported)`,
  ];
  if (plan.stories.length < 3) lines.push(`note: fewer than 3 stories for this day`);
  return lines;
}

/** Insert the planned days. Each day is its own issue + run; a refused day is left alone. */
export function applyImport(ctx: Context, plans: DayPlan[], reports: { file: string; data: any }[]): void {
  for (const plan of plans) {
    if (plan.refused || plan.stories.length === 0) continue;
    if (ctx.db.getIssue(plan.date)) continue; // re-check just before writing
    const data = reports.find((r) => r.data.meta.date === plan.date)!.data;
    storeIssue(ctx, plan.date, plan.stories.map((s) => s.row), false, plan.at);
    const runId = ctx.db.startRun(plan.date, plan.at);
    const scope = { runId, jobId: null, at: plan.at };
    ctx.db.transaction(() => {
      for (const c of plan.calls) {
        const id = recordCall(ctx.db, ctx.config, scope, c.stage, c.usage);
        if (c.outcome) markOutcome(ctx.db, id, c.outcome);
      }
    });
    ctx.db.finishRun(runId, "created", runDetail(plan, data), new Date(plan.at.getTime() + plan.seconds * 1000));
  }
}

export function describe(plans: DayPlan[], dryRun: boolean): string {
  const out: string[] = [dryRun ? "DRY RUN: nothing will be written" : "IMPORT"];
  for (const p of plans) {
    out.push(`\n${p.date} (${path.basename(p.file)})`);
    if (p.refused) {
      out.push(`  refused: ${p.refused}`);
      continue;
    }
    out.push(`  issue v1 at ${p.at.toISOString()}, ${p.stories.length} stories, run ${p.seconds}s, ${p.calls.length} llm_calls, cost $${p.cost_usd.toFixed(4)}`);
    for (const s of p.stories) out.push(`  + #${s.position} [${s.candidate_id}] ${s.title} (${s.row.word_count} words) <- ${s.source_url}`);
    for (const s of p.skipped) out.push(`  - skip ${s.title}: ${s.reason}`);
    for (const s of p.failed) out.push(`  x failed ${s.title}: ${s.reasons.join("; ")}`);
    for (const c of p.calls) out.push(`  $ ${c.label} ${c.usage.model} in=${c.usage.input_tokens} out=${c.usage.output_tokens} $${(c.usage.cost_usd ?? 0).toFixed(6)}${c.outcome ? ` (${c.outcome})` : ""}`);
    if (p.stories.length < 3) out.push(`  note: fewer than 3 stories`);
  }
  const total = plans.reduce((n, p) => n + (p.refused ? 0 : p.cost_usd), 0);
  out.push(`\ntotal: ${plans.reduce((n, p) => n + (p.refused ? 0 : p.stories.length), 0)} stories, $${total.toFixed(4)}`);
  out.push("articles archive: not updated (the reports do not carry the candidate list)");
  return out.join("\n");
}

export function openContext(settings: Settings, config: Config, profileId?: string): Context {
  const db = new Database(dbPath(settings));
  db.init();
  return buildContext(settings, config, db, { writer: new StubLLM(), profileId });
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const p = args.indexOf("--profile");
  const files = args.filter((a, i) => !a.startsWith("--") && !(p >= 0 && i === p + 1));
  if (!files.length) {
    process.stderr.write("usage: import-comparison.ts [--dry-run] [--profile <id>] <model-comparison-YYYY-MM-DD.json>...\n");
    process.exit(2);
  }
  const reports = files.map((file) => ({ file, data: JSON.parse(readFileSync(file, "utf8")) }));
  const profile = profileFromArgs(settingsFromEnv(), args);
  const ctx = openContext(profile.settings, profile.config, profile.id);
  try {
    const plans = planImport(ctx.db, reports);
    process.stdout.write(describe(plans, dryRun) + "\n");
    if (!dryRun) {
      applyImport(ctx, plans, reports);
      process.stdout.write("done\n");
    }
  } finally {
    ctx.db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
