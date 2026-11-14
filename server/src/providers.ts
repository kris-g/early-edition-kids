/**
 * Provider registry (CONTRACT.md "Two providers side by side"): Anthropic and OpenRouter can both be
 * configured, and the writer and checker each pick a namespaced model ("anthropic:…" or
 * "openrouter:…"). LLM_BASE_URL=stub and the generic LLM_PROVIDER=openai path are kept as before.
 */

import { isStub, type Config, type Settings } from "./config.js";

export type ProviderId = "anthropic" | "openrouter";
/** What a model id resolves to. "openai" is the generic OpenAI-compatible endpoint (LLM_BASE_URL). */
export type ModelProvider = ProviderId | "openai" | "stub";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export const PROVIDER_NAMES: Record<ProviderId, string> = { anthropic: "Anthropic", openrouter: "OpenRouter" };

/** Models offered for Anthropic, with a plain note for a parent. Ids are bare here; offered namespaced. */
export const ANTHROPIC_MODELS: { id: string; name: string; note: string }[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "The most careful writer and checker. Costs the most." },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Nearly as good as Opus, at about half the cost." },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "The fastest and cheapest. Its writing is plainer." },
];

/** The generic OpenAI-compatible endpoint from before the registry: LLM_PROVIDER=openai, or a base URL alone. */
export function isLegacyOpenAI(s: Settings): boolean {
  if (isStub(s)) return false;
  const p = s.llmProvider.trim().toLowerCase();
  if (p === "openai") return true;
  if (p) return false;
  return Boolean(s.llmBaseUrl);
}

export interface Injected {
  anthropic?: boolean;
  openrouter?: boolean;
}

/** Which providers have a key (or, in tests, an injected client). */
export function configured(s: Settings, injected: Injected = {}): Record<ProviderId, boolean> {
  if (isStub(s) || isLegacyOpenAI(s)) return { anthropic: false, openrouter: false };
  return {
    anthropic: Boolean(s.llmApiKey) || Boolean(injected.anthropic),
    openrouter: Boolean(s.openrouterApiKey) || Boolean(injected.openrouter),
  };
}

/** "anthropic:x" / "openrouter:y"; a bare id means anthropic (or the generic endpoint in legacy mode). */
export function splitModel(id: string, s: Settings): { provider: ModelProvider; model: string } {
  if (isStub(s) || id === "stub") return { provider: "stub", model: "stub" };
  const i = id.indexOf(":");
  if (i > 0) {
    const prefix = id.slice(0, i);
    if (prefix === "anthropic" || prefix === "openrouter" || prefix === "openai") return { provider: prefix, model: id.slice(i + 1) };
  }
  if (isLegacyOpenAI(s)) return { provider: "openai", model: id };
  return { provider: "anthropic", model: id };
}

/** Namespace a (possibly bare) id. Legacy generic-endpoint models stay bare. */
export function namespaced(id: string, s: Settings): string {
  if (!id) return id;
  const { provider, model } = splitModel(id, s);
  if (provider === "stub") return "stub";
  if (provider === "openai") return id.startsWith("openai:") ? model : id;
  return `${provider}:${model}`;
}

export interface CatalogEntry {
  id: string;
  provider: ProviderId;
  name: string;
  note: string;
  input_per_mtok: number;
  output_per_mtok: number;
}

/** Every model of every configured provider, namespaced, with its price. */
export function catalog(s: Settings, config: Config, injected: Injected = {}): CatalogEntry[] {
  const on = configured(s, injected);
  const out: CatalogEntry[] = [];
  if (on.anthropic) {
    for (const m of ANTHROPIC_MODELS) {
      const p = config.llmPrices[m.id] ?? { input_per_mtok: 0, output_per_mtok: 0 };
      out.push({ id: `anthropic:${m.id}`, provider: "anthropic", name: m.name, note: m.note, ...p });
    }
  }
  if (on.openrouter) {
    for (const m of config.openrouterModels) {
      out.push({
        id: `openrouter:${m.id}`,
        provider: "openrouter",
        name: m.name,
        note: m.note,
        input_per_mtok: m.input_per_mtok,
        output_per_mtok: m.output_per_mtok,
      });
    }
  }
  return out;
}

/** Price for a recorded model id (namespaced or bare), or null when unknown. */
export function priceOf(config: Config, model: string): { input_per_mtok: number; output_per_mtok: number } | null {
  const i = model.indexOf(":");
  const prefix = i > 0 ? model.slice(0, i) : "";
  const bare = i > 0 ? model.slice(i + 1) : model;
  if (prefix === "openrouter") {
    const m = config.openrouterModels.find((x) => x.id === bare);
    if (m) return { input_per_mtok: m.input_per_mtok, output_per_mtok: m.output_per_mtok };
  }
  return config.llmPrices[bare] ?? null;
}
