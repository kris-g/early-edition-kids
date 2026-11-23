/**
 * Types for the parent dashboard JSON API (CONTRACT.md "Parent dashboard (React PWA)").
 *
 * The web app imports this file by relative path (`../server/src/dashboard/types.ts`), so it must
 * stay free of runtime imports and code: types only.
 */

export type StoryStats = {
  opened: boolean;
  reached_end: boolean;
  active_seconds: number;
  expected_seconds: number;
  engaged: boolean;
  /** London date he first read it to the end, or null. Can be after the paper's own date. */
  read_on: string | null;
};

export type StoryCard = {
  id: number;
  date: string;
  version: number;
  position: number;
  topic: string;
  title: string;
  teaser: string;
  minutes: number;
  word_count: number;
  hidden: boolean;
  added_by_parent: boolean;
  reused: boolean;
  source_name: string;
  source_url: string;
  source_title: string | null;
  stats: StoryStats;
};

/** One number in a story's title, teaser or body, and whether the source text has it too. */
export type NumberCheck = {
  /** As compared: digits with thousands commas stripped ("1300" for "1,300"). */
  value: string;
  in_source: boolean;
};

/** What the pipeline found when it checked a story (CONTRACT.md "Story checks"). */
export type StoryChecks = {
  numbers: NumberCheck[];
  /** The checker's verdict on the published version. `reasons` is usually empty when it passed. */
  verdict: { safe: boolean; supported: boolean; reasons: string[] };
  /** Rewrites it took: 1, or 2 when the first was sent back. */
  attempts: number;
  /** The models that answered, namespaced as in the AI settings, or "stub". */
  writer_model: string | null;
  checker_model: string | null;
};

export type StoryDetail = StoryCard & {
  /**
   * The <body> content he sees, no <html>/<head>. With `checks`, the dashboard's copy also has
   * `<mark data-check="number" data-value="1300">` around each checked number and
   * `<mark data-check="word">` around the bold word to know; the Kindle and the iPad never get these.
   */
  body_html: string;
  word_to_know: { word: string; definition: string } | null;
  think_about_it: string;
  prev_id: number | null;
  next_id: number | null;
  /** The photo the iPad reader shows, at GET /stories/:id/image, or null when the story has none. */
  image: { alt: string | null } | null;
  /** Null for a story made before checks were kept; its body_html then has no marks. */
  checks: StoryChecks | null;
  /** When the story was written (UTC ISO). For a catch-up story, when its original was. */
  created_at: string;
};

export type IssueView = {
  date: string;
  version: number;
  fallback: boolean;
  created_at: string;
  downloaded_by: { device: string; version: number; received_at: string }[];
  read_count: number;
  /** Includes hidden ones, flagged. */
  stories: StoryCard[];
};

/** One story he read (or opened) on a day, from any paper. */
export type DayRead = {
  story: StoryCard;
  /** When he last closed it that day (UTC ISO, the Kindle's time). */
  at: string;
  /** Reading time that day. */
  active_seconds: number;
  /** Read to the end that day. */
  finished: boolean;
};

/** GET /day/:date: what he read that day, and that day's paper. */
export type DayView = {
  date: string;
  /** Stories read to the end that day, from any paper. */
  read: number;
  minutes: number;
  /** Everything opened that day, oldest first. */
  reads: DayRead[];
  /** That day's own paper, or null if there was none. */
  paper: IssueView | null;
  /** Time on the Sport page that day, or null when it wasn't opened (docs/sports-page.md 5.4). */
  sport: SportDay | null;
  /** How that day's paper went toward opening Sport, with stories read too fast; null with no lock. */
  sport_unlock: UnlockStatus | null;
};

// ---- the Sport page (docs/sports-page.md 2.7, 5.4): kept apart from reading ----

/** Set on the dashboard per child; config.yaml's `sports` block gives the starting values. */
export type SportSettings = {
  /** Whether this child has the Sport page. */
  enabled: boolean;
  /** Share of today's stories to read before Sport opens, 0 to 1. 0 turns the lock off. */
  read_first: number;
  /** A story counts only after this share of its expected reading time; 0 counts any read to the end. */
  min_reading: number;
};

export type UnlockStory = {
  id: number;
  title: string;
  finished: boolean;
  active_seconds: number;
  min_seconds: number;
  /** Read to the end, and not too fast. */
  counts: boolean;
  /** Read to the end, but faster than `min_seconds`. */
  rushed: boolean;
};

/** How far a paper's reading got toward opening Sport. */
export type UnlockStatus = {
  needed: number;
  total: number;
  counted: number;
  unlocked: boolean;
  /** When the story that opened it was closed, UTC ISO. */
  unlocked_at: string | null;
  stories: UnlockStory[];
};

export type SportSettingsView = {
  settings: SportSettings;
  /** Today's progress, or null when there is no lock today. */
  today: UnlockStatus | null;
};

export type SportPage = "matches" | "table" | "next" | "match";

export type SportPageUse = {
  page: SportPage;
  /** For a match page: which match, and its name, such as "Liverpool 4–0 Man Utd". */
  match_id: string | null;
  match: string | null;
  views: number;
  seconds: number;
};

export type SportDay = {
  date: string;
  views: number;
  seconds: number;
  /** That day's totals per page, and per match, most time first. */
  pages: SportPageUse[];
};

export type SportUsageView = {
  from: string;
  to: string;
  /** Oldest first, one per date, gaps filled with zeros. */
  days: SportDay[];
  views: number;
  seconds: number;
  /** The range's totals per page, most time first. */
  pages: SportPageUse[];
};

export type IssueSummary = { date: string; version: number; fallback: boolean; story_count: number; read_count: number };

export type TopicMode = "pin" | "block" | null;

export type TopicView = {
  name: string;
  /** One short line for a parent (config `description`), or null. Not the topic's `notes`, which are for the AI. */
  description: string | null;
  base_weight: number;
  effective_weight: number;
  mode: TopicMode;
  shown: number;
  opened: number;
  engaged: number;
  open_rate: number;
  engagement_rate: number;
};

export type ArticleHit = {
  url: string;
  source_name: string;
  title: string;
  summary: string;
  published_at: string | null;
  already_used: boolean;
};

export type JobStatus = "pending" | "done" | "failed";
export type AddWhen = "today" | "tomorrow";

export type Job = { id: string; status: JobStatus; when: AddWhen; story: StoryCard | null; reasons: string[] };

export type RunView = { started_at: string; finished_at: string | null; date: string; status: string; detail: string[] };

export type Summary = {
  today: IssueView | null;
  streak: number;
  week_read: number;
  last_run: RunView | null;
  /** Dashboard v2 */
  streak_detail: Streak;
  last_run_cost: RunCost | null;
  /** When the Kindle last synced (asked for today's paper or sent reading), or null. */
  kindle_seen_at: string | null;
  /** Stories from earlier papers read to the end today. */
  catch_up_today: number;
};

/** GET /api/dashboard/profiles (CONTRACT.md "Profiles"). */
export type ProfileInfo = { id: string; title: string };
export type ProfilesView = {
  profiles: ProfileInfo[];
  /** The profile also served at /api/dashboard (the one that owns the root data), or null. */
  root: string | null;
  /** True when the built-in sign-in is on (DASHBOARD_PASSWORD). */
  login: boolean;
  /** The Kindle port as reached on the home network, without a trailing slash: KINDLE_BASE_URL, or derived. */
  kindle_base_url: string;
  /** True when KINDLE_BASE_URL is unset and the address was worked out from this request's host name. */
  kindle_base_url_derived: boolean;
};

/** GET /api/dashboard/about (CONTRACT.md "About this server"): the server itself, the same for every profile. */
export type AboutView = {
  /** The server's version, from its package.json. */
  version: string;
  /** Node's process.arch, e.g. "arm64" or "x64". */
  arch: string;
  /** Node's process.platform, e.g. "linux" or "darwin". */
  platform: string;
  /** What it runs in, when that can be told: Kubernetes, a plain Docker container, or neither (null). */
  container: "kubernetes" | "docker" | null;
  /** Whole seconds since the server process started. */
  uptime_seconds: number;
  /** The Sport page's last fetch, or null when no profile shows it (docs/sports-page.md 5.4). */
  sport: { updated_at: string | null; attempted_at: string | null; error: string | null } | null;
};

export type GenerateResponse = {
  date: string;
  version: number | null;
  fallback: boolean;
  story_count: number;
  status: "created" | "exists" | "failed";
};

// Request bodies
export type LoginRequest = { password: string };
export type RegenerateRequest = { confirm?: boolean };
export type TopicModeRequest = { mode: TopicMode };
export type AddArticleRequest = { url: string; when: AddWhen };

export type ApiError = { error: string };

// ---- Dashboard v2: reading stats, calendar and AI (CONTRACT.md) ----

export type Streak = {
  current: number;
  current_since: string | null;
  longest: number;
  longest_from: string | null;
  longest_to: string | null;
};

export type ReadingDay = {
  date: string;
  issue: boolean;
  /** Stories in that day's issue (0 if none). */
  stories: number;
  /** Stories read that day (any issue). */
  read: number;
  minutes: number;
};

export type ReadingView = {
  from: string;
  to: string;
  /** Oldest first, one per date, gaps filled with zeros. */
  days: ReadingDay[];
  streak: Streak;
  reading_days: number;
  total_read: number;
  avg_read_per_day: number;
  avg_minutes_per_day: number;
  /** In the range, configured topics in config order. */
  topics: { name: string; read: number; shown: number }[];
};

export type CalendarView = {
  /** "2026-11" */
  month: string;
  /** Every date of the month; future dates have issue: false, read: 0. */
  days: (ReadingDay & { all_read: boolean })[];
  total_read: number;
  reading_days: number;
  all_read_days: number;
  elapsed_days: number;
};

export type ProviderId = "anthropic" | "openrouter";

export type ModelOption = {
  /** Namespaced: "anthropic:claude-opus-5-5", "openrouter:anthropic/claude-opus-5.5". */
  id: string;
  provider: ProviderId;
  /** e.g. "Claude Opus 5.5" */
  name: string;
  note: string;
  input_per_mtok: number;
  output_per_mtok: number;
  /** select + rewrite for a normal day at this model; from the last 14 days' average tokens; null without data. */
  est_day_writer_usd: number | null;
  est_day_checker_usd: number | null;
};

export type Effort = "low" | "medium" | "high";

export type AiSettings = {
  /** The writer model's provider. */
  provider: "anthropic" | "openrouter" | "openai" | "stub";
  writer_model: string;
  check_model: string;
  writer_effort: Effort;
  check_effort: Effort;
  monthly_limit_usd: number | null;
};

export type StageCost = { stage: "select" | "rewrite" | "check" | "add"; calls: number; cost_usd: number };

export type RunCost = {
  run_id: number;
  date: string;
  started_at: string;
  seconds: number | null;
  status: string;
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  /** Checker rejections in this run. */
  sent_back: number;
  /** Model refusals in this run. */
  refused: number;
  /** Namespaced model ids. */
  models: string[];
  stages: StageCost[];
};

export type AiView = {
  settings: AiSettings;
  /** Models of every configured provider; empty for openai/stub. */
  models: ModelOption[];
  providers: {
    id: ProviderId;
    name: string;
    /** One line for a parent on what the provider is. */
    description: string;
    configured: boolean;
    last_used: string | null;
  }[];
  last_run: RunCost | null;
  month: {
    month: string;
    cost_usd: number;
    limit_usd: number | null;
    projected_usd: number;
    /** Every date of the month so far. */
    days: { date: string; cost_usd: number }[];
  };
  quality: {
    /** This month. */
    sent_back: number;
    refused: number;
    /** Issues published before 07:00 this month, of all issues this month. */
    on_time: number;
    issues: number;
    avg_seconds: number | null;
  };
  provider_last_used: string | null;
};

export type AiSettingsUpdate = Partial<{
  writer_model: string;
  check_model: string;
  writer_effort: Effort;
  check_effort: Effort;
  monthly_limit_usd: number | null;
}>;

// ---- Share cards (CONTRACT.md "Share cards") ----

export type ShareStory = { id: number; topic: string; title: string; teaser: string };

export type ShareView = {
  /** Europe/London date the cards are for. */
  today: string;
  streak: Streak;
  /** The last 14 days, oldest first. */
  fortnight: ReadingDay[];
  /** Stories read to the end today (any issue), in the order he finished them. */
  today_read: { stories: ShareStory[]; minutes: number; in_paper: number };
  /** The last 7 days, oldest first, ending today. */
  week: {
    from: string;
    to: string;
    days: ReadingDay[];
    total_read: number;
    minutes: number;
    reading_days: number;
    /** Up to 3 topics by stories read, most first. */
    top_topics: string[];
  };
  /** Different stories read to the end, ever. */
  total_read: number;
  /** The latest story-count milestone reached, or null before the first. */
  milestone: { stories: number; date: string; story: ShareStory | null; next: number } | null;
  /** Words to know from stories read in the last 7 days, newest first, up to 4, one per word. */
  words: { word: string; definition: string; story_title: string }[];
  /** Stories read today, or else on the latest reading day in the last 7 days; up to 3. */
  ask: { date: string | null; stories: ShareStory[] };
};
