/**
 * AI settings a parent can change from the dashboard (CONTRACT.md "Dashboard v2" -> "AI settings",
 * and "Two providers side by side"). Stored in the `settings` table with namespaced model ids
 * ("anthropic:…", "openrouter:…"); when a value is unset the env value applies. They are read when a
 * generation or an added article starts, so a change never affects a run already under way.
 */

import { isStub, type Config, type Settings } from "./config.js";
import { loadsJson, type Database } from "./db.js";
import { EFFORTS, type Effort } from "./llm.js";
import {
  ANTHROPIC_MODELS,
  DEFAULT_ANTHROPIC_MODEL,
  PROVIDER_NAMES,
  catalog,
  configured,
  isLegacyOpenAI,
  namespaced,
  splitModel,
  type Injected,
  type ModelProvider,
} from "./providers.js";

export { ANTHROPIC_MODELS };

export type ProviderName = ModelProvider;

export interface AiSettings {
  /** The writer model's provider. */
  provider: ProviderName;
  writer_model: string;
  check_model: string;
  writer_effort: Effort;
  check_effort: Effort;
  monthly_limit_usd: number | null;
}

const KEY = "ai";
type Stored = Partial<Omit<AiSettings, "provider">>;

function readStored(db: Database): Stored {
  const row = db.queryOne("SELECT value FROM settings WHERE key = ?", [KEY]);
  const v = loadsJson<Stored>(row?.value, {});
  return v && typeof v === "object" ? v : {};
}

function writeStored(db: Database, v: Stored): void {
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [KEY, JSON.stringify(v)]);
}

/** Stored settings with bare model ids namespaced (an old bare id means anthropic). */
export function storedAiSettings(settings: Settings, db: Database): Stored {
  const v = readStored(db);
  for (const key of ["writer_model", "check_model"] as const) {
    if (typeof v[key] === "string" && v[key]) v[key] = namespaced(v[key]!, settings);
  }
  return v;
}

/** Rewrite stored bare model ids as namespaced ones. Run once at start-up. */
export function migrateStoredModelIds(settings: Settings, db: Database): void {
  const raw = readStored(db);
  const fixed = storedAiSettings(settings, db);
  if (raw.writer_model !== fixed.writer_model || raw.check_model !== fixed.check_model) writeStored(db, fixed);
}

const effortOr = (v: string, fallback: Effort): Effort => ((EFFORTS as readonly string[]).includes(v) ? (v as Effort) : fallback);

function defaultWriter(settings: Settings, injected: Injected): string {
  if (isStub(settings)) return "stub";
  if (isLegacyOpenAI(settings)) return settings.llmModel;
  if (settings.llmModel) return namespaced(settings.llmModel, settings);
  const on = configured(settings, injected);
  if (!on.anthropic && on.openrouter) return "openrouter:anthropic/claude-opus-5.5";
  return `anthropic:${DEFAULT_ANTHROPIC_MODEL}`;
}

/** Database values first, then env, then defaults (medium to write, high to check). */
export function effectiveAiSettings(settings: Settings, db: Database, injected: Injected = {}): AiSettings {
  const stored = storedAiSettings(settings, db);
  const legacy = isStub(settings) || isLegacyOpenAI(settings);
  const writer = (!legacy && stored.writer_model) || defaultWriter(settings, injected);
  const envCheck = settings.checkLlmModel ? (legacy ? settings.checkLlmModel : namespaced(settings.checkLlmModel, settings)) : "";
  const check = (!legacy && stored.check_model) || envCheck || writer;
  return {
    provider: isStub(settings) ? "stub" : splitModel(writer || "x", settings).provider,
    writer_model: writer,
    check_model: check,
    writer_effort: stored.writer_effort ?? effortOr(settings.llmEffort.trim().toLowerCase(), "medium"),
    check_effort: stored.check_effort ?? effortOr(settings.checkLlmEffort.trim().toLowerCase(), "high"),
    monthly_limit_usd: typeof stored.monthly_limit_usd === "number" ? stored.monthly_limit_usd : null,
  };
}

export class SettingsError extends Error {}

/** Validate and merge a PUT /ai body. Throws SettingsError with a plain sentence. */
export function updateAiSettings(settings: Settings, db: Database, config: Config, patch: unknown, injected: Injected = {}): AiSettings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new SettingsError("Send the settings to change as a JSON object.");
  const p = patch as Record<string, unknown>;
  const offered = catalog(settings, config, injected).map((m) => m.id);
  const on = configured(settings, injected);
  const next: Stored = { ...storedAiSettings(settings, db) };
  for (const key of ["writer_model", "check_model"] as const) {
    if (!(key in p)) continue;
    const v = p[key];
    if (typeof v !== "string" || !v) throw new SettingsError("Choose a model from the list.");
    if (isStub(settings) || isLegacyOpenAI(settings)) {
      throw new SettingsError("The model can't be changed from the dashboard while the server uses the stub or a generic endpoint.");
    }
    const id = namespaced(v, settings);
    const { provider } = splitModel(id, settings);
    if ((provider === "anthropic" || provider === "openrouter") && !on[provider]) {
      const keyName = provider === "anthropic" ? "LLM_API_KEY" : "OPENROUTER_API_KEY";
      throw new SettingsError(`${PROVIDER_NAMES[provider]} isn't set up on the server (${keyName} is missing), so its models can't be chosen.`);
    }
    if (!offered.includes(id)) throw new SettingsError(`${JSON.stringify(v)} is not one of the models on offer.`);
    next[key] = id;
  }
  for (const key of ["writer_effort", "check_effort"] as const) {
    if (!(key in p)) continue;
    const v = p[key];
    if (typeof v !== "string" || !(EFFORTS as readonly string[]).includes(v)) {
      throw new SettingsError(`Effort must be low, medium or high, not ${JSON.stringify(v)}.`);
    }
    next[key] = v as Effort;
  }
  if ("monthly_limit_usd" in p) {
    const v = p.monthly_limit_usd;
    if (v === null) delete next.monthly_limit_usd;
    else if (typeof v !== "number" || !Number.isFinite(v)) throw new SettingsError("The monthly limit must be a number of dollars, or null for no limit.");
    else if (v < 0) throw new SettingsError("The monthly limit cannot be negative.");
    else next.monthly_limit_usd = v;
  }
  writeStored(db, next);
  return effectiveAiSettings(settings, db, injected);
}

/** Settings with the effective AI choices applied, for building the LLM clients. */
export function settingsForLlms(settings: Settings, db: Database, injected: Injected = {}): Settings {
  if (isStub(settings) || isLegacyOpenAI(settings)) return settings;
  const ai = effectiveAiSettings(settings, db, injected);
  return {
    ...settings,
    llmModel: ai.writer_model,
    checkLlmModel: ai.check_model,
    llmEffort: ai.writer_effort,
    checkLlmEffort: ai.check_effort,
  };
}
