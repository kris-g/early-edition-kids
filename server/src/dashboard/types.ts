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

export type StoryDetail = StoryCard & {
  /** The <body> content he sees, no <html>/<head>. */
  body_html: string;
  word_to_know: { word: string; definition: string } | null;
  think_about_it: string;
  prev_id: number | null;
  next_id: number | null;
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

export type IssueSummary = { date: string; version: number; fallback: boolean; story_count: number; read_count: number };

export type TopicMode = "pin" | "block" | null;

export type TopicView = {
  name: string;
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
  providers: { id: ProviderId; name: string; configured: boolean; last_used: string | null }[];
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
