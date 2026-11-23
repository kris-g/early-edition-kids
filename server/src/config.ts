/** Settings from the environment (secrets) and the YAML config file (CONTRACT.md "Runtime"). */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The built web app (web/dist), relative to the server/ directory. */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));
/** The built iPad reader (reader/dist), relative to the server/ directory. */
export const DEFAULT_READER_DIR = fileURLToPath(new URL("../../reader/dist", import.meta.url));

export const APP_NAME = "Early Edition Kids";
export const VERSION = "0.2.0";

export const TOPIC_NAMES = [
  "Liverpool FC",
  "England",
  "Football",
  "Science",
  "Space",
  "Animals and nature",
  "Games and tech",
  "Weather",
  "Weird but true",
] as const;

export class ConfigError extends Error {}

export interface Settings {
  dataDir: string;
  configPath: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKey: string;
  openrouterApiKey: string;
  llmModel: string;
  checkLlmModel: string;
  llmEffort: string;
  checkLlmEffort: string;
  adminToken: string;
  webDir: string;
  /** EARLY_EDITION_KIDS_READER_DIR: the built iPad reader, served at <mount>/read/ on the Kindle port. */
  readerDir: string;
  /** KINDLE_BASE_URL: the Kindle port as reached on the home network (for the dashboard's iPad card); empty means derive it. */
  kindleBaseUrl: string;
  host: string;
  port: number;
  dashboardPort: number;
  /** GENERATE_AT: "HH:MM" London time for the built-in daily run; empty means none (a CronJob calls /admin/generate). */
  generateAt: string;
  /** DASHBOARD_PASSWORD: turns on the built-in dashboard sign-in; empty means none (CONTRACT.md "Built-in sign-in"). */
  dashboardPassword: string;
  /** DASHBOARD_USER: the user name asked for at sign-in; empty means only the password is asked for. */
  dashboardUser: string;
  /** SESSION_SECRET: mixed into the session cookie key, so cookies can be revoked without changing the password. */
  sessionSecret: string;
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    dataDir: env.EARLY_EDITION_KIDS_DATA_DIR || "./data",
    configPath: env.EARLY_EDITION_KIDS_CONFIG || "./config.yaml",
    llmProvider: env.LLM_PROVIDER || "",
    llmBaseUrl: (env.LLM_BASE_URL || "").trim(),
    llmApiKey: env.LLM_API_KEY || "",
    openrouterApiKey: env.OPENROUTER_API_KEY || "",
    llmModel: env.LLM_MODEL || "",
    checkLlmModel: env.CHECK_LLM_MODEL || "",
    llmEffort: env.LLM_EFFORT || "",
    checkLlmEffort: env.CHECK_LLM_EFFORT || "",
    adminToken: env.ADMIN_TOKEN || "",
    webDir: env.EARLY_EDITION_KIDS_WEB_DIR || DEFAULT_WEB_DIR,
    readerDir: env.EARLY_EDITION_KIDS_READER_DIR || DEFAULT_READER_DIR,
    kindleBaseUrl: normaliseBaseUrl(env.KINDLE_BASE_URL),
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 8080),
    dashboardPort: Number(env.DASHBOARD_PORT || 8081),
    generateAt: (env.GENERATE_AT || "").trim(),
    dashboardPassword: env.DASHBOARD_PASSWORD || "",
    dashboardUser: (env.DASHBOARD_USER || "").trim(),
    sessionSecret: env.SESSION_SECRET || "",
  };
}

/**
 * KINDLE_BASE_URL without a trailing slash, or "" when unset. A value that is not an http(s) URL is
 * ignored with a warning, so a typo never stops the server.
 */
export function normaliseBaseUrl(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname && !u.search && !u.hash) {
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    }
  } catch {
    // fall through
  }
  console.warn(`KINDLE_BASE_URL is not an http address (${JSON.stringify(raw)}); ignoring it`);
  return "";
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...settingsFromEnv({}), ...overrides };
}

export const dbPath = (s: Settings) => path.join(s.dataDir, "early-edition-kids.db");
export const issuesDir = (s: Settings) => path.join(s.dataDir, "issues");
export const isStub = (s: Settings) => s.llmBaseUrl.toLowerCase() === "stub";

/** The original range; config `story_words` overrides it. */
export const DEFAULT_STORY_WORDS = { min: 100, max: 160 };

export interface ModelPrice {
  input_per_mtok: number;
  output_per_mtok: number;
}

/** Defaults from CONTRACT.md; config `llm_prices` entries override or add to them. */
export const DEFAULT_LLM_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input_per_mtok: 4, output_per_mtok: 20 },
  "claude-sonnet-5-5": { input_per_mtok: 2, output_per_mtok: 10 },
  "claude-haiku-5-5": { input_per_mtok: 0.1, output_per_mtok: 0.5 },
};

export interface OpenRouterModel {
  /** OpenRouter's own id, e.g. "anthropic/claude-opus-5.5" (offered as "openrouter:" + id). */
  id: string;
  name: string;
  note: string;
  input_per_mtok: number;
  output_per_mtok: number;
}

/** Defaults from CONTRACT.md; config `openrouter_models` replaces the whole list. */
export const DEFAULT_OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5 (OpenRouter)",
    note: "The same careful Claude Opus, billed through OpenRouter.",
    input_per_mtok: 4,
    output_per_mtok: 20,
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5 (OpenRouter)",
    note: "Nearly as good as Opus at about half the cost, through OpenRouter.",
    input_per_mtok: 2,
    output_per_mtok: 10,
  },
  {
    id: "moonshotai/kimi-k3.1-pro",
    name: "Kimi K3.1 Pro (OpenRouter)",
    note: "A strong model from another company; worth trying as a second opinion.",
    input_per_mtok: 2,
    output_per_mtok: 10,
  },
  {
    id: "x-ai/grok-4.7",
    name: "Grok 4.7 (OpenRouter)",
    note: "Another company's model; cheaper to write with, so check its stories closely.",
    input_per_mtok: 2,
    output_per_mtok: 6,
  },
  {
    id: "z-ai/glm-5.3",
    name: "GLM 5.3 (OpenRouter)",
    note: "Very low cost; untested for children's writing",
    input_per_mtok: 0.08,
    output_per_mtok: 3.6,
  },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro (OpenRouter)",
    note: "Very low cost; untested for children's writing",
    input_per_mtok: 0.11,
    output_per_mtok: 4.44,
  },
];

/** How the iPad reader shows a story: turning pages, or one long scrolling paper. */
export const READER_MODES = ["pages", "scroll"] as const;
export type ReaderMode = (typeof READER_MODES)[number];

export interface Topic {
  name: string;
  baseWeight: number;
  /** For the AI that picks the stories. Never shown on the dashboard. */
  notes: string;
  /** One short line for a parent, shown on the dashboard's Topics page. Never sent to the AI. */
  description: string | null;
}

export interface Feed {
  name: string;
  url: string;
  kidsSource: boolean;
  topicHint: string | null;
  excludeUrlPatterns: string[];
  excludeTitlePatterns: string[];
}

export interface Config {
  title: string;
  childAge: number;
  storyCount: number;
  readingWpm: number;
  topics: Topic[];
  feeds: Feed[];
  blocklist: string[];
  favouritePlayers: string[];
  favouriteTeam: string;
  rivalClubs: string[];
  /** Prompts skip women's and girls' football (config mens_football_only, default false). */
  mensFootballOnly: boolean;
  // Not in CONTRACT.md's key list; optional tuning knobs with safe defaults.
  reserves: number;
  maxAgeHours: number;
  dedupeDays: number;
  fallbackDays: number;
  minSourceWords: number;
  sourceCharLimit: number;
  llmConcurrency: number;
  /** Story body length in words (CONTRACT/DESIGN 4.2). Default 100 to 160. */
  storyWords: { min: number; max: number };
  /** The iPad reader's reading mode (config reader_mode, default pages). */
  readerMode: ReaderMode;
  /** USD per million tokens, per model (CONTRACT.md "LLM usage"). */
  llmPrices: Record<string, ModelPrice>;
  /** Models offered through OpenRouter (CONTRACT.md "Two providers side by side"). */
  openrouterModels: OpenRouterModel[];
  /**
   * The Sport page (docs/sports-page.md): the starting values for its settings. A parent changes
   * them on the dashboard, which overrides these (sports/settings.ts).
   */
  sports: SportDefaults;
}

export interface SportDefaults {
  /** Whether the page is shown. Off by default. */
  enabled: boolean;
  /** Share of today's stories to read before Sport opens, 0 to 1; 0 means no lock. */
  readFirst: number;
  /** A story counts only after this share of its expected reading time, 0 to 1. */
  minReading: number;
}

const strList = z
  .array(z.union([z.string(), z.number()]).transform(String))
  .nullish()
  .transform((v) => v ?? []);
const optInt = (d: number) =>
  z
    .union([z.number(), z.string().regex(/^-?\d+$/)])
    .nullish()
    .transform((v) => (v === null || v === undefined ? d : Math.trunc(Number(v))));

const topicSchema = z.object({
  name: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  base_weight: z.union([z.number(), z.string()]).nullish().transform((v) => (v === null || v === undefined ? 1 : Number(v))),
  notes: z.string().nullish().transform((v) => v ?? ""),
  description: z.string().nullish().transform((v) => v?.trim() || null),
});

const feedSchema = z.object({
  name: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  url: z.string().min(1),
  kids_source: z.boolean().nullish().transform((v) => v ?? false),
  topic_hint: z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined || v === "" ? null : String(v))),
  exclude_url_patterns: strList,
  exclude_title_patterns: strList,
});

const configSchema = z.object({
  title: z.string().nullish(),
  child_age: optInt(8),
  story_count: optInt(6),
  reading_wpm: optInt(90),
  topics: z.array(topicSchema).nullish(),
  feeds: z.array(feedSchema).nullish(),
  blocklist: strList,
  favourite_players: strList,
  favourite_team: z.string().nullish(),
  rival_clubs: strList,
  mens_football_only: z.boolean().nullish().transform((v) => v ?? false),
  reserves: optInt(4),
  max_age_hours: optInt(48),
  dedupe_days: optInt(14),
  fallback_days: optInt(7),
  min_source_words: optInt(150),
  source_char_limit: optInt(6000),
  llm_concurrency: optInt(3),
  story_words: z
    .object({ min: z.number().int().min(1), max: z.number().int().min(1) })
    .refine((w) => w.max >= w.min, { message: "max must be at least min" })
    .nullish(),
  reader_mode: z
    .enum(READER_MODES, { error: "must be pages or scroll" })
    .nullish(),
  openrouter_models: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        note: z.string().nullish().transform((v) => v ?? ""),
        input_per_mtok: z.number().min(0),
        output_per_mtok: z.number().min(0),
      }),
    )
    .nullish(),
  llm_prices: z
    .record(z.string(), z.object({ input_per_mtok: z.number().min(0), output_per_mtok: z.number().min(0) }))
    .nullish(),
  sports: z
    .object({
      enabled: z.boolean().nullish(),
      read_first: z.number().min(0).max(1).nullish(),
      min_reading: z.number().min(0).max(1).nullish(),
    })
    .nullish(),
});

export function parseConfig(data: unknown): Config {
  const parsed = configSchema.safeParse(data ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ConfigError(`config: ${first?.path.join(".") || "(root)"}: ${first?.message}`);
  }
  const c = parsed.data;
  let topics: Topic[] = (c.topics ?? []).map((t) => ({ name: t.name, baseWeight: t.base_weight, notes: t.notes, description: t.description }));
  if (topics.length === 0) topics = TOPIC_NAMES.map((name) => ({ name, baseWeight: 1, notes: "", description: null }));
  const feeds: Feed[] = (c.feeds ?? []).map((f) => ({
    name: f.name,
    url: f.url,
    kidsSource: f.kids_source,
    topicHint: f.topic_hint,
    excludeUrlPatterns: f.exclude_url_patterns,
    excludeTitlePatterns: f.exclude_title_patterns,
  }));
  const names = new Set(topics.map((t) => t.name));
  for (const f of feeds) {
    if (f.topicHint && !names.has(f.topicHint)) {
      throw new ConfigError(`feed '${f.name}' has topic_hint '${f.topicHint}' which is not a configured topic`);
    }
  }
  if (c.story_count < 1) throw new ConfigError("story_count must be at least 1");
  return {
    title: c.title || "Early Edition",
    childAge: c.child_age,
    storyCount: c.story_count,
    readingWpm: Math.max(1, c.reading_wpm),
    topics,
    feeds,
    blocklist: c.blocklist.filter((w) => w.trim()),
    favouritePlayers: c.favourite_players,
    favouriteTeam: (c.favourite_team || "").trim(),
    rivalClubs: c.rival_clubs.filter((x) => x.trim()),
    mensFootballOnly: c.mens_football_only,
    reserves: c.reserves,
    maxAgeHours: c.max_age_hours,
    dedupeDays: c.dedupe_days,
    fallbackDays: c.fallback_days,
    minSourceWords: c.min_source_words,
    sourceCharLimit: c.source_char_limit,
    llmConcurrency: Math.max(1, c.llm_concurrency),
    storyWords: c.story_words ?? { ...DEFAULT_STORY_WORDS },
    readerMode: c.reader_mode ?? "pages",
    llmPrices: { ...DEFAULT_LLM_PRICES, ...(c.llm_prices ?? {}) },
    openrouterModels: c.openrouter_models ?? DEFAULT_OPENROUTER_MODELS,
    sports: {
      enabled: c.sports?.enabled === true,
      readFirst: c.sports?.read_first ?? 0.5,
      minReading: c.sports?.min_reading ?? 0.5,
    },
  };
}

function readConfigFile(file: string): unknown {
  if (!existsSync(file)) {
    throw new ConfigError(`config file not found: ${file} (set EARLY_EDITION_KIDS_CONFIG; see config.example.yaml)`);
  }
  return YAML.parse(readFileSync(file, "utf8"));
}

/** The top-level config only (a `profiles:` list is ignored). Profile-aware callers use loadProfiles. */
export function loadConfig(file: string): Config {
  return parseConfig(readConfigFile(file));
}

// ---- profiles (CONTRACT.md "Profiles") ----

/** The id of the one implicit profile when the config has no `profiles:` list. */
export const DEFAULT_PROFILE = "default";
export const PROFILE_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Keys that stay global: a profile may not override them. */
const GLOBAL_KEYS = ["llm_prices", "openrouter_models"];

export interface ProfileConfig {
  id: string;
  config: Config;
}

export interface ProfilesConfig {
  profiles: ProfileConfig[];
  /** True when the file has a `profiles:` list (false: one implicit `default` profile). */
  explicit: boolean;
}

/**
 * Each profile is the top level with its own keys laid over it (a shallow merge: a list replaces
 * the top-level list rather than adding to it), validated like a whole config.
 */
export function parseProfiles(data: unknown): ProfilesConfig {
  const top = data ?? {};
  if (typeof top !== "object" || Array.isArray(top)) throw new ConfigError("config: (root): expected a mapping");
  const { profiles, ...base } = top as Record<string, unknown>;
  if (profiles === undefined || profiles === null) {
    return { profiles: [{ id: DEFAULT_PROFILE, config: parseConfig(base) }], explicit: false };
  }
  if (!Array.isArray(profiles) || profiles.length === 0) throw new ConfigError("config: profiles must be a list with at least one entry");
  const seen = new Set<string>();
  const out: ProfileConfig[] = [];
  profiles.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ConfigError(`config: profiles.${i}: expected a mapping with an id`);
    }
    const { id, ...own } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !PROFILE_ID.test(id)) {
      throw new ConfigError(`config: profiles.${i}.id must be lowercase letters, digits and hyphens (for example older), not ${JSON.stringify(id)}`);
    }
    if (seen.has(id)) throw new ConfigError(`config: profile id '${id}' is used twice`);
    seen.add(id);
    for (const k of GLOBAL_KEYS) {
      if (k in own) throw new ConfigError(`config: profile '${id}': ${k} applies to every profile; set it at the top level`);
    }
    try {
      out.push({ id, config: parseConfig({ ...base, ...own }) });
    } catch (err) {
      if (err instanceof ConfigError) throw new ConfigError(`profile '${id}': ${err.message}`);
      throw err;
    }
  });
  return { profiles: out, explicit: true };
}

export function loadProfiles(file: string): ProfilesConfig {
  return parseProfiles(readConfigFile(file));
}

export const topicNames = (c: Config) => c.topics.map((t) => t.name);
