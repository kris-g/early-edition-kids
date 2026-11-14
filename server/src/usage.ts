/** LLM usage recording and cost (CONTRACT.md "Dashboard v2" -> "LLM usage"). */

import type { Config } from "./config.js";
import { utcnowIso, type Database } from "./db.js";
import { priceOf } from "./providers.js";
import { londonDate } from "./timeutil.js";

export type Stage = "select" | "rewrite" | "check" | "add";

/** What a provider reports for one API response. */
export interface CallUsage {
  provider: string;
  /** The model that actually answered (for Anthropic, possibly a server-side fallback model). */
  model: string;
  input_tokens: number;
  output_tokens: number;
  stop_reason: string | null;
  /** The provider's own reported cost in USD (OpenRouter `usage.cost`), used instead of the price table. */
  cost_usd?: number;
}

/** Which generation run or parent-add job the calls belong to. */
export interface UsageScope {
  runId: number | null;
  jobId: string | null;
  /** Parent-added articles record every call as stage "add". */
  stage?: Stage;
  /** The time calls are recorded at: the run or job's own clock (so a run's cost lands on its day). */
  at?: Date;
}

export function costOf(config: Config, model: string, input: number, output: number): { cost: number; priced: boolean } {
  const price = priceOf(config, model);
  if (!price) return { cost: 0, priced: false };
  return { cost: (input / 1e6) * price.input_per_mtok + (output / 1e6) * price.output_per_mtok, priced: true };
}

/** Cost of one call: the provider's reported cost, else the price table; the stub is free. */
export function callCost(config: Config, u: CallUsage): { cost: number; priced: boolean } {
  if (u.provider === "stub") return { cost: 0, priced: true };
  if (typeof u.cost_usd === "number" && Number.isFinite(u.cost_usd)) return { cost: u.cost_usd, priced: true };
  return costOf(config, u.model, u.input_tokens, u.output_tokens);
}

/** Insert one call; returns its id. The stub's model is free and not flagged as unpriced. */
export function recordCall(db: Database, config: Config, scope: UsageScope, stage: Stage, u: CallUsage, at = scope.at ?? new Date()): number {
  const { cost, priced } = callCost(config, u);
  if (!priced) console.warn(`no price for model ${u.model}; recorded at $0 (add it to llm_prices)`);
  return db.run(
    "INSERT INTO llm_calls (run_id, job_id, at, stage, provider, model, input_tokens, output_tokens, stop_reason, cost_usd, priced) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      scope.runId,
      scope.jobId,
      utcnowIso(at),
      scope.stage ?? stage,
      u.provider,
      u.model,
      Math.max(0, Math.round(u.input_tokens || 0)),
      Math.max(0, Math.round(u.output_tokens || 0)),
      u.stop_reason,
      cost,
      priced ? 1 : 0,
    ],
  ).lastId;
}

/** For checker calls: "pass" or "sent_back" (a checker rejection). */
export function markOutcome(db: Database, callId: number | null, outcome: "pass" | "sent_back"): void {
  if (callId !== null) db.run("UPDATE llm_calls SET outcome = ? WHERE id = ?", [outcome, callId]);
}

/** Month-to-date cost in USD for the Europe/London month containing `now`. */
export function monthToDateCost(db: Database, now: Date): number {
  const month = londonDate(now).slice(0, 7);
  return callsInMonth(db, month).reduce((sum, r) => sum + Number(r.cost_usd), 0);
}

/** All calls whose London date falls in `month` ("YYYY-MM"). */
export function callsInMonth(db: Database, month: string) {
  // Widen the UTC window by a day each side, then filter by London date exactly.
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 86400_000).toISOString();
  const end = new Date(Date.UTC(y, m, 1) + 86400_000).toISOString();
  return db
    .query("SELECT * FROM llm_calls WHERE at >= ? AND at < ? ORDER BY at", [start, end])
    .filter((r) => londonDate(new Date(r.at)).startsWith(month));
}
