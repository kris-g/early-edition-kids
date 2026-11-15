# Early Edition Kids: interface contract

The exact interfaces shared by `server/`, `plugin/earlyeditionkids.koplugin/` and `deploy/`. DESIGN.md is the spec; this file pins the details that more than one part depends on. If you need to change anything here, say so in your report rather than silently diverging.

## Runtime

- Server listens on two ports, plain HTTP: 8080 for the Kindle, 8081 for the dashboard (see "Auth" under "Parent dashboard").
- Timezone for "today" and the schedule: `Europe/London`.
- Daily run: either a Kubernetes CronJob calls `POST /admin/generate`, or env `GENERATE_AT` (`HH:MM`, London time) makes the server run it itself, at that time or at start when later. Both are safe together: runs are serialised and a date that already has a paper returns `exists`.
- Data directory: env `EARLY_EDITION_KIDS_DATA_DIR` (default `./data`; `/data` in the container). SQLite at `$EARLY_EDITION_KIDS_DATA_DIR/early-edition-kids.db`, story files under `$EARLY_EDITION_KIDS_DATA_DIR/issues/`.
- Config file: env `EARLY_EDITION_KIDS_CONFIG` (default `./config.yaml`; `/config/config.yaml` in the container, from a ConfigMap). YAML with keys: `title` (default "Early Edition"), `child_age` (8), `story_count` (6), `reading_wpm` (90), `story_words` (`{min, max}` body length in words; 100 / 160 if unset, 120 / 200 in the deployed config), `topics` (list of `{name, base_weight, notes}`), `feeds` (list of `{name, url, kids_source, topic_hint, exclude_url_patterns, exclude_title_patterns}`), `blocklist` (list of words), `favourite_players` (list).
- Secrets as env: `LLM_PROVIDER` (`anthropic` or `openai`; defaults to `openai` when `LLM_BASE_URL` is a URL), `LLM_API_KEY`, `LLM_MODEL` (Anthropic default `claude-opus-5-5`), optional `CHECK_LLM_MODEL`, `LLM_BASE_URL` (OpenAI-compatible only, or `stub`), optional `LLM_EFFORT` / `CHECK_LLM_EFFORT` (Anthropic only; default `medium` / `high`), `ADMIN_TOKEN`. Optional `EARLY_EDITION_KIDS_WEB_DIR` (where the built web app is), `PORT` (8080), `DASHBOARD_PORT` (8081), `HOST` (`127.0.0.1` by default; `0.0.0.0` in the container).
- Stub LLM: when `LLM_BASE_URL` is `stub`, the server uses canned responses and needs no key or network for the LLM (feeds may still be fetched; tests use fixture feeds).

## Topics (exact strings)

`Liverpool FC`, `Football`, `Science`, `Space`, `Animals and nature`, `Games and tech`, `Weather`, `Weird but true`.

## HTTP API

### `GET /api/issue/today` and `GET /api/issue/{YYYY-MM-DD}`

200:

```json
{
  "date": "2026-11-13",
  "version": 1,
  "fallback": false,
  "title": "Early Edition",
  "number": 12,
  "created_at": "2026-11-13T05:31:07+00:00",
  "stories": [
    {"id": 41, "position": 1, "topic": "Football", "title": "Harry Kane wins the Ballon d'Or",
     "teaser": "The first English winner for 25 years.", "minutes": 2,
     "path": "/issues/2026-11-13/v1/1.html",
     "word_to_know": {"word": "ceremony", "definition": "a special event held to celebrate something."}}
  ],
  "hidden": [43],
  "reading_since": "2026-11-14"
}
```

- `today` means the Europe/London date on the server. 404 with `{"detail": "..."}` if today's issue does not exist. Never returns an older issue.
- `stories` excludes hidden stories, ordered by `position`. `hidden` lists the ids of this version's stories a parent has hidden. Positions are not renumbered when a story is hidden.
- `id` is globally unique and stable. A regenerated issue has a higher `version` and new ids.
- `minutes` = max(1, round(word_count / reading_wpm)).
- `path` is server-relative; the client joins it to its `server_url` and never builds it.
- `number` is the edition number: how many distinct issue dates exist up to and including this date (1 for the first issue ever). It does not change when a date is regenerated.
- `created_at` is when this version was made, ISO 8601 in UTC.
- `word_to_know` per story is `{word, definition}` or `null`, the same as the box at the end of the story page.
- `reading_since` is the date reading history was last reset, or `null` if it never was (see "Reading since").
- Clients must ignore fields they do not know; the server may add fields but will not remove or change these.

### Reading since

Reading is recorded in two places: events on the server (the dashboard and topic weighting) and the Kindle's own reading log (My week, its streak and words). They are kept in step only by this rule:

- `tsx scripts/reset-reading.ts --since YYYY-MM-DD` deletes the server's events read before that London date and stores the date as `reading_since`.
- Every issue response carries `reading_since`. At each sync the plugin stores it and drops reading-log entries read before it (by the day read, or the issue date for entries older than that field).
- `POST /api/events` accepts events read before `reading_since` (they are listed in `accepted`, so the Kindle stops resending them) but does not store them.
- Hiding a story is not a reset: reading that already happened still counts on both sides.

### `GET /issues/{date}/v{version}/{position}.html`

`text/html; charset=utf-8`, standalone story page (DESIGN 4.8). Served for hidden stories too (a device may already have it), but clients should not show them.

### `POST /api/events`

Request:

```json
{"device_id": "b5c1...", "events": [
  {"client_event_id": "uuid", "story_id": 41, "type": "story_closed", "ts": 1763013600,
   "payload": {"active_seconds": 95, "pages_total": 2, "max_page": 2, "finished": true}}
]}
```

- `type` is one of `issue_downloaded`, `list_shown` (payload `{date, version}`, `story_id` null), `story_opened` (payload `{}`), `story_closed` (payload as above).
- Response 200: `{"accepted": ["uuid", ...]}` listing every `client_event_id` now stored, including ones that were already stored from an earlier upload. The client deletes exactly those from its queue.
- Unknown `story_id` or unknown `type`: the event is not stored and not in `accepted`; the response is still 200. The client keeps those for at most 7 days, then drops them.
- Max 500 events per request.

### Admin and parent

- `POST /admin/generate[?force=true][&date=YYYY-MM-DD]` with header `X-Admin-Token`. 200 `{"date","version","fallback","story_count","status": "created"|"exists"}`. 503 with `"status": "failed"` when nothing could be published (the CronJob's `curl -f` then marks the job failed). A forced run that fails keeps the existing version.
- `GET /healthz` returns 200 `ok`.
- The dashboard and its API are on port 8081 only (see "Parent dashboard").

## Parent-added articles

- **Archive:** every article fetched from a configured feed is kept for 30 days (`articles(url PK, source_name, title, summary, published_at, fetched_at)`), whether or not it was picked. Items matching the feed's exclude patterns (videos, podcasts, quizzes) are not archived.
- **Find:** the dashboard's "Find articles" page searches that archive by keyword (title and summary, newest first) and also accepts a pasted article URL from any site.
- **Add:** each result has "Add to today" and "Add for tomorrow". Adding runs the same extract, rewrite and check steps as the pipeline (DESIGN 4.1 steps 4 to 6); a story that fails is not added and the dashboard shows the reasons. The parent cannot bypass the checks.
  - **Today:** appended to today's issue as a new story with the next free `position`, in the **same** `version`. It appears in `/api/issue/today` at once.
  - **Tomorrow:** stored as a request; the next generation includes it as one of its `story_count` picks and skips it in selection.
- **Device:** when a sync returns the same date and version, any story in `stories` that the device does not have is downloaded and added to the headline list in `position` order.

## Parent dashboard (React PWA)

The dashboard is a separate front end in `web/` (React, TypeScript, Vite, Tailwind, `vite-plugin-pwa`), built to static files and served by the Express server at `/dashboard/` (SPA fallback to `index.html`, service worker scope `/dashboard/`). It talks only to the JSON API below. There are no server-rendered dashboard pages. In development, Vite runs on its own port and proxies `/api/dashboard` to `http://localhost:8081` and the rest of `/api` to `http://localhost:8080`.

### Auth: Authelia in front, none in the app

The app has no login, password, session or user of its own. Access control is Authelia on the edge, and the dashboard is only reachable through it:

- **Two ports.** The server listens on `PORT` (8080) for the Kindle routes only (`/api/issue/*`, `/issues/*`, `/api/events`, `/admin/generate`, `/healthz`), and on `DASHBOARD_PORT` (8081) for the dashboard only (`/dashboard/*`, `/api/dashboard/*`, `/healthz`; `GET /` redirects to `/dashboard/`). Neither port serves the other's routes (404).
- **Exposure.** Port 8080 is the LAN LoadBalancer the Kindle uses. Port 8081 is ClusterIP only and is reached solely through the dashboard's Ingress, on Traefik's `websecure` entrypoint, with TLS from the default TLSStore and an Authelia `forwardAuth` middleware (use a two-factor policy). Plain HTTP is redirected to HTTPS.
- **No identity headers.** The existing middleware does not forward `Remote-User`, so the app does not know or need to know who is signed in.
- **Session expiry.** When the Authelia session expires, an API `fetch` gets a redirect to the Authelia sign-in page instead of JSON. The web app fetches with `redirect: "manual"`; an `opaqueredirect` response (or a 401) means "signed out", and it reloads the page so the browser does the Authelia sign-in, then comes back.
- **CSRF guard.** Every non-GET `/api/dashboard/*` route still requires the header `X-Early-Edition: 1` and returns 403 without it.
- **Local development.** Both ports bind to `127.0.0.1` unless `HOST` is set; there is no auth locally.
- Errors are `{error: "message"}` with a suitable status.

### Shapes

```ts
type StoryStats = { opened: boolean; reached_end: boolean; active_seconds: number;
                    expected_seconds: number; engaged: boolean };
type StoryCard = { id: number; date: string; version: number; position: number; topic: string;
                   title: string; teaser: string; minutes: number; word_count: number;
                   hidden: boolean; added_by_parent: boolean; reused: boolean;
                   source_name: string; source_url: string; source_title: string | null;
                   stats: StoryStats };
type StoryDetail = StoryCard & { body_html: string;              // the <body> content he sees, no <html>/<head>
                                 word_to_know: { word: string; definition: string } | null;
                                 think_about_it: string; prev_id: number | null; next_id: number | null };
type IssueView = { date: string; version: number; fallback: boolean; created_at: string;
                   downloaded_by: { device: string; version: number; received_at: string }[];
                   read_count: number; stories: StoryCard[] };   // includes hidden ones, flagged
type IssueSummary = { date: string; version: number; fallback: boolean; story_count: number; read_count: number };
type TopicView = { name: string; base_weight: number; effective_weight: number; mode: "pin" | "block" | null;
                   shown: number; opened: number; engaged: number; open_rate: number; engagement_rate: number };
type ArticleHit = { url: string; source_name: string; title: string; summary: string;
                    published_at: string | null; already_used: boolean };
type Job = { id: string; status: "pending" | "done" | "failed"; when: "today" | "tomorrow";
             story: StoryCard | null; reasons: string[] };
type RunView = { started_at: string; finished_at: string | null; date: string; status: string; detail: string[] };
```

### Routes (all under `/api/dashboard`)

| Method and path | Returns |
|---|---|
| `GET /summary` | `{today: IssueView \| null, streak: number, week_read: number, last_run: RunView \| null}` |
| `GET /issues?limit=30` | `IssueSummary[]`, newest first |
| `GET /issues/:date` | `IssueView` for the latest version of that date, or 404 |
| `GET /stories/:id` | `StoryDetail` |
| `POST /stories/:id/hide`, `POST /stories/:id/unhide` | `StoryCard` |
| `POST /regenerate` `{confirm: true}` | the `/admin/generate?force=true` result; 409 `{error}` without `confirm` when a device has already downloaded today's issue |
| `GET /topics` | `TopicView[]` |
| `POST /topics/:name` `{mode: "pin" \| "block" \| null}` | `TopicView` |
| `GET /articles/search?q=` | `ArticleHit[]` (max 30). Empty `q` returns the newest 30. |
| `POST /articles/add` `{url, when: "today" \| "tomorrow"}` | 202 `Job` (rewriting takes tens of seconds) |
| `GET /jobs/:id` | `Job`; the web app polls every 2 seconds until it is not `pending` |
| `GET /runs?limit=10` | `RunView[]` |

### Dashboard v2: reading stats, calendar and AI (added 13 November 2026)

Design: the canvas "Early Edition Kids: parent dashboard designs" (mockup files `Main`, `Reading`, `Calendar`, `AI`, `Desktop` `.dc.html`). Everything above stays; these are additions. All dates are Europe/London `YYYY-MM-DD`; money is US dollars as numbers.

**Definitions.**
- A story is **read** when the device reported it was read to the end (`story_closed` with `finished: true`). Engagement (DESIGN 4.4) is unchanged and still drives topic weights.
- A **reading day** is a date with at least one story read, counted by the date of the read (server receive time, Europe/London), not the issue's date.
- The **streak** is the run of consecutive reading days ending today, or ending yesterday if nothing has been read yet today (so it doesn't drop to 0 each morning). `current_since` is its first day.
- **Minutes** is the sum of `active_seconds` from `story_closed` events that day, divided by 60, rounded to one decimal.

**LLM usage.** Every LLM call is recorded: `{run_id | job_id, at, stage: "select" | "rewrite" | "check" | "add", model (the model that actually answered, including a fallback), input_tokens, output_tokens, stop_reason, cost_usd}`. Cost comes from a price table in config (`llm_prices`, per model, USD per million input and output tokens; defaults: `claude-opus-5-5` 4 / 20, `claude-sonnet-5-5` 2 / 10, `claude-haiku-5-5` 0.10 / 0.50; unknown models cost 0 and are flagged). The stub records calls with 0 cost.

**AI settings.** Stored in the database; when unset, the env values (`LLM_MODEL`, `CHECK_LLM_MODEL`, `LLM_EFFORT`, `CHECK_LLM_EFFORT`) apply. A change applies from the next LLM call (the next generation or added article), never mid-run. Optional `monthly_limit_usd`: when month-to-date cost has reached it, a scheduled generation does not call the LLM and publishes the catch-up issue instead, with "monthly AI limit reached" in the run log; parent-added articles are refused with that message.

```ts
type Streak = { current: number; current_since: string | null; longest: number;
                longest_from: string | null; longest_to: string | null };
type ReadingDay = { date: string; issue: boolean; stories: number;   // stories in that day's issue (0 if none)
                    read: number;                                    // stories read that day (any issue)
                    minutes: number };
type ReadingView = { from: string; to: string; days: ReadingDay[];   // oldest first, one per date, gaps filled with zeros
                     streak: Streak; reading_days: number; total_read: number;
                     avg_read_per_day: number; avg_minutes_per_day: number;
                     topics: { name: string; read: number; shown: number }[] };   // in the range, configured topics in config order
type CalendarView = { month: string;                                 // "2026-11"
                      days: (ReadingDay & { all_read: boolean })[];  // every date of the month; future dates have issue: false, read: 0
                      total_read: number; reading_days: number; all_read_days: number; elapsed_days: number };
type ModelOption = { id: string; name: string; note: string;          // name e.g. "Claude Opus 5.5"
                     input_per_mtok: number; output_per_mtok: number;
                     est_day_writer_usd: number | null;                // select + rewrite for a normal day at this model
                     est_day_checker_usd: number | null };             // from the last 14 days' average tokens; null without data
type Effort = "low" | "medium" | "high";
type AiSettings = { provider: "anthropic" | "openai" | "stub"; writer_model: string; check_model: string;
                    writer_effort: Effort; check_effort: Effort; monthly_limit_usd: number | null };
type StageCost = { stage: "select" | "rewrite" | "check" | "add"; calls: number; cost_usd: number };
type RunCost = { run_id: number; date: string; started_at: string; seconds: number | null; status: string;
                 calls: number; cost_usd: number; input_tokens: number; output_tokens: number;
                 sent_back: number;                                    // checker rejections in this run
                 refused: number;                                      // model refusals in this run
                 models: string[]; stages: StageCost[] };
type AiView = { settings: AiSettings; models: ModelOption[];          // models offered for the provider; empty for openai/stub
                last_run: RunCost | null;
                month: { month: string; cost_usd: number; limit_usd: number | null; projected_usd: number;
                         days: { date: string; cost_usd: number }[] };   // every date of the month so far
                quality: { sent_back: number; refused: number;       // this month
                           on_time: number; issues: number;          // issues published before 07:00 this month, of all issues this month
                           avg_seconds: number | null };
                provider_last_used: string | null };
```

| Method and path | Returns |
|---|---|
| `GET /summary` | gains `streak_detail: Streak` and `last_run_cost: RunCost \| null`; existing fields unchanged |
| `GET /reading?days=14` | `ReadingView` for the last `days` days (7–120, default 14) ending today |
| `GET /calendar?month=YYYY-MM` | `CalendarView` (default this month) |
| `GET /ai` | `AiView` |
| `PUT /ai` `Partial<{writer_model, check_model, writer_effort, check_effort, monthly_limit_usd}>` | `AiView`; 400 `{error}` for a model not offered by the provider, a bad effort, or a negative limit. `monthly_limit_usd: null` removes the limit. Needs `X-Early-Edition: 1`. |

### Two providers side by side: Anthropic and OpenRouter (added 13 November 2026)

Both providers can be configured at once, and the writer and the checker can each use a model from either.

- **Keys.** `LLM_API_KEY` stays the Anthropic key. `OPENROUTER_API_KEY` (its own Secret, `early-edition-kids-openrouter-key`, read as optional) enables OpenRouter at `https://openrouter.ai/api/v1`. A provider without a key shows `configured: false` and its models can't be chosen.
- **Model ids are namespaced:** `anthropic:claude-opus-5-5`, `openrouter:anthropic/claude-opus-5.5`. Stored settings and `PUT /ai` use these. A bare id (old setting or env) means `anthropic:` when `LLM_PROVIDER` is `anthropic`.
- **OpenRouter models** come from config `openrouter_models: [{id, name, note, input_per_mtok, output_per_mtok}]`. Defaults: `anthropic/claude-opus-5.5` (Claude Opus 5.5 via OpenRouter, 4 / 20), `anthropic/claude-sonnet-5.5` (2 / 10), `moonshotai/kimi-k3.1-pro` (Kimi K3.1 Pro, 2 / 10), `x-ai/grok-4.7` (Grok 4.7, 2 / 6), `z-ai/glm-5.3` (GLM 5.3, 0.08 / 3.60), `deepseek/deepseek-v4-pro-0813` (DeepSeek V4 Pro, 0.11 / 4.44). Only models OpenRouter lists with structured-output support belong here (so not `z-ai/glm-5.3-prime`). Requests use the OpenAI-compatible chat API with `response_format` JSON schema (strict), `reasoning: {effort}` and `usage: {include: true}`; the recorded cost is OpenRouter's reported `usage.cost` when present, else the price table.
- **Shapes:** `ModelOption` gains `provider: "anthropic" | "openrouter"` and its `id` is namespaced. `AiView.models` lists the models of every configured provider. `AiView` gains `providers: { id: "anthropic" | "openrouter"; name: string; configured: boolean; last_used: string | null }[]`. `AiSettings.provider` now reports the writer model's provider. `RunCost.models` holds namespaced ids.
- **No automatic failover** between providers yet: a call that fails on its provider fails as before (the run uses reserves or the catch-up issue).

### Share cards (added 14 November 2026)

The Share page turns his reading into a picture to send to family: six cards (Streak, Today, His week, Milestone, Words learned, Ask me about) in a swipeable row, each a 1080 × 1350 PNG in one of three colours (Paper, Green, Night). The cards are drawn in the browser on a canvas, so the server sends only numbers and headlines, and the picture goes nowhere until the parent shares, copies or saves it. The optional name on the cards is typed in the browser and kept in its `localStorage` (`early-edition.share-name`); it is never sent to the server. `/share?card=<id>` opens on a card.

- **Milestones** count different stories read to the end, ever: 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, then every 100. The card shows the latest one reached and the story that reached it.
- **Words** are the stories' word to know, from stories read in the last 7 days, newest first, one per word, up to 4.
- **Ask me about** uses the stories read today, or else those read on the latest reading day in the last 7 days, up to 3.
- A card with nothing to show (no two-day streak yet, nothing read today, no milestone yet, no words) says why instead of being drawn.

```ts
type ShareStory = { id: number; topic: string; title: string; teaser: string };
type ShareView = { today: string; streak: Streak;
                   fortnight: ReadingDay[];                                  // last 14 days, oldest first
                   today_read: { stories: ShareStory[]; minutes: number; in_paper: number };
                   week: { from: string; to: string; days: ReadingDay[];      // last 7 days ending today
                           total_read: number; minutes: number; reading_days: number; top_topics: string[] };
                   total_read: number;                                       // different stories read, ever
                   milestone: { stories: number; date: string; story: ShareStory | null; next: number } | null;
                   words: { word: string; definition: string; story_title: string }[];
                   ask: { date: string | null; stories: ShareStory[] } };
```

| Method and path | Returns |
|---|---|
| `GET /share` | `ShareView` for today |

## Plugin sync rules (so the server can rely on them)

On start and on resume, the plugin syncs if any of:

1. it is after `earliest_fetch_hour` and it has no issue for today (by the date the server last reported, or the device date if none);
2. there are queued events;
3. it has today's issue and its last successful check was more than 30 minutes ago (this is how hides and new versions reach it).

After a story closes, the plugin also uploads queued events on their own, with no issue fetch: one minute after the last story closed, only if Wi-Fi is already on, and not while another story is open (it waits until that one closes). Going to sleep cancels it; the wake-up sync sends them instead. This keeps the dashboard current within a minute or two of his reading.

A sync uploads events, then fetches `/api/issue/today`. If the date and version match what it has, it applies `hidden` (removes those stories from the headline list and deletes their files). A higher version replaces the stored issue only if no story from it has been opened.
