# Early Edition Kids: interface contract

The exact interfaces shared by `server/`, `plugin/earlyeditionkids.koplugin/` and `deploy/`. DESIGN.md is the spec; this file pins the details that more than one part depends on. If you need to change anything here, say so in your report rather than silently diverging.

## Runtime

- Server listens on two ports, plain HTTP: 8080 for the Kindle, 8081 for the dashboard (see "Auth" under "Parent dashboard").
- Timezone for "today" and the schedule: `Europe/London`.
- Daily run: either a Kubernetes CronJob calls `POST /admin/generate`, or env `GENERATE_AT` (`HH:MM`, London time) makes the server run it itself, at that time or at start when later. Both are safe together: runs are serialised and a date that already has a paper returns `exists`.
- Data directory: env `EARLY_EDITION_KIDS_DATA_DIR` (default `./data`; `/data` in the container). SQLite at `$EARLY_EDITION_KIDS_DATA_DIR/early-edition-kids.db`, story files under `$EARLY_EDITION_KIDS_DATA_DIR/issues/`. With several profiles, see "Profiles" for where the others live.
- Config file: env `EARLY_EDITION_KIDS_CONFIG` (default `./config.yaml`; `/config/config.yaml` in the container, from a ConfigMap). YAML with keys: `title` (default "Early Edition"), `child_age` (8), `story_count` (6), `reading_wpm` (90), `story_words` (`{min, max}` body length in words; 100 / 160 if unset, 120 / 200 in the deployed config), `topics` (list of `{name, base_weight, notes, description}`; `notes` go to the AI that picks the stories, the optional `description` is one short line for a parent on the dashboard and is never sent to the AI), `feeds` (list of `{name, url, kids_source, topic_hint, exclude_url_patterns, exclude_title_patterns}`), `blocklist` (list of words), `favourite_players` (list), `reader_mode` (`pages` or `scroll`, default `pages`; see "iPad reader"), `sports` (`{enabled, read_first, min_reading}`, default off, 0.5, 0.5: starting values a parent changes on the dashboard; see "Sport page"), and optionally `profiles` (see "Profiles").
- Secrets as env: `LLM_PROVIDER` (`anthropic` or `openai`; defaults to `openai` when `LLM_BASE_URL` is a URL), `LLM_API_KEY`, `LLM_MODEL` (Anthropic default `claude-opus-5-5`), optional `CHECK_LLM_MODEL`, `LLM_BASE_URL` (OpenAI-compatible only, or `stub`), optional `LLM_EFFORT` / `CHECK_LLM_EFFORT` (Anthropic only; default `medium` / `high`), `ADMIN_TOKEN`. Optional `EARLY_EDITION_KIDS_WEB_DIR` (where the built web app is), `EARLY_EDITION_KIDS_READER_DIR` (where the built iPad reader is), `KINDLE_BASE_URL` (see "iPad reader"), `PORT` (8080), `DASHBOARD_PORT` (8081), `HOST` (`127.0.0.1` by default; `0.0.0.0` in the container), and `DASHBOARD_PASSWORD`, `DASHBOARD_USER`, `SESSION_SECRET` (see "Built-in sign-in").
- Stub LLM: when `LLM_BASE_URL` is `stub`, the server uses canned responses and needs no key or network for the LLM (feeds may still be fetched; tests use fixture feeds).

## Profiles (added 15 November 2026)

One server can make a paper for more than one child. Each profile is a full copy of the single-child setup: its own merged config, database, issues folder, Kindle address, dashboard, AI settings and monthly limit. Nothing is added up across children.

- **Config.** An optional top-level `profiles:` list. Each entry has a required `id` (lowercase letters, digits and hyphens, unique; never a name: use something like `older` / `younger`) and may override any other top-level key. The merge is shallow: a profile's key replaces the top-level one, and a list replaces the list rather than adding to it. Each merged profile is validated like a whole config. `llm_prices` and `openrouter_models` are global; setting them in a profile is an error. No `profiles:` key means one implicit profile, `default`, exactly as before.
- **Data.** The root location (`$DATA/early-edition-kids.db` and `$DATA/issues/`) belongs to one profile id. The first time the config has a `profiles:` list, the server records the first listed id as its owner in `$DATA/profiles.json` (`{"root": "older"}`); without a list nothing is written and `default` owns it. Every other profile keeps its data in `$DATA/profiles/<id>/` (the same two names inside). Data is found by id, never by position, so adding, removing or reordering profiles never gives one child's data to another. If the recorded owner is not in the config, the server logs a warning and leaves the root data unused (nothing is served at `/`) until a profile with that id is back. A single-child setup is never migrated or moved.
- **Kindle port.** Every profile's Kindle routes are mounted at `/p/<id>/` (`/p/<id>/api/issue/today`, `/p/<id>/issues/...`, `/p/<id>/api/events`, and the iPad reader at `/p/<id>/read/` with `/p/<id>/api/reader`), and the root owner's are also at `/`, so an existing Kindle keeps working unchanged. An unknown id is a 404. A second child's Kindle uses `http://<server>:8080/p/<id>` as its server address; story `path`s stay relative to the mount (no `/p/<id>`), and the plugin joins them to the address.
- **Dashboard port.** The dashboard API is at `/api/dashboard/p/<id>/...` for every profile, and also at `/api/dashboard/...` for the root owner. `GET /api/dashboard/profiles` returns `ProfilesView` (below). The web app keeps today's URLs with one profile; with several (or when no profile owns the root data) its pages are under `/dashboard/p/<id>/`, `/dashboard/` opens the child used last on that device (or the first), and a switcher in the header shows the profile id.
- **Generation.** `POST /admin/generate` and `GENERATE_AT` run every profile in turn; one lock shared by all profiles means two papers are never made at once (see "Admin and parent").
- **Scripts.** `reset-reading.ts`, `rewrite-issues.ts` and `import-comparison.ts` take `--profile <id>` (default: the root owner). `src/backup.ts` copies every profile's database.

```ts
type ProfilesView = { profiles: { id: string; title: string }[];   // config order
                      root: string | null;                          // the profile also served at /api/dashboard, or null
                      login: boolean;                               // the built-in sign-in is on
                      kindle_base_url: string;                      // see "iPad reader"
                      kindle_base_url_derived: boolean };
```

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
     "word_to_know": {"word": "ceremony", "definition": "a special event held to celebrate something."},
     "image": {"path": "/issues/2026-11-13/v1/1.jpg", "alt": "Harry Kane holds the trophy"},
     "kindle_image": {"path": "/issues/2026-11-13/v1/1.kindle.jpg"}}
  ],
  "hidden": [43],
  "reading_since": "2026-11-14",
  "profile": "default",
  "profile_root": true
}
```

- `today` means the Europe/London date on the server. 404 with `{"detail": "..."}` if today's issue does not exist. Never returns an older issue.
- `stories` excludes hidden stories, ordered by `position`. `hidden` lists the ids of this version's stories a parent has hidden. Positions are not renumbered when a story is hidden.
- `id` is unique and stable within a profile. A regenerated issue has a higher `version` and new ids.
- `minutes` = max(1, round(word_count / reading_wpm)).
- `path` is server-relative; the client joins it to its `server_url` and never builds it.
- `number` is the edition number: how many distinct issue dates exist up to and including this date (1 for the first issue ever). It does not change when a date is regenerated.
- `created_at` is when this version was made, ISO 8601 in UTC.
- `word_to_know` per story is `{word, definition}` or `null`, the same as the box at the end of the story page.
- `image` per story (added 16 November 2026) is the story's photo, `{path, alt}` or `null` (see "Story photos"). `path` is server-relative like the story's `path`; `alt` is the source's description or `null`. The iPad shows it.
- `kindle_image` per story (added 16 November 2026) is `{path}` for the Kindle's copy of that photo, or `null` when the story has no photo (see "Story photos"). Its path can still answer 404 when the photo cannot be made into a Kindle copy.
- `reading_since` is the date reading history was last reset, or `null` if it never was (see "Reading since").
- `sports` (added 23 November 2026) is `{path: "/api/sports", label: "Premier League", matchday, unlock}` when this paper has a Sport page with something to show, else `null` (see "Sport page"). `path` is relative to the mount, like a story's. `unlock` is `{needed, min_seconds}` for this paper's lock, or `null` with none (see "Read first").
- `profile` is the id of the profile this paper is for (`default` without a profiles list); `profile_root` is true when that profile owns the root data. Story ids restart at 1 in each profile's database, so a client treats a change of paper as a fresh start. The paper differs when exactly one side has `profile_root`, or neither has and the ids differ. The root data stays the same paper when its owner's id changes, which happens once: from `default` to the first listed profile.
- Clients must ignore fields they do not know; the server may add fields but will not remove or change these.

### Reading since

Reading is recorded in two places: events on the server (the dashboard and topic weighting) and the Kindle's own reading log (My week, its streak and words). They are kept in step only by this rule:

- `tsx scripts/reset-reading.ts --since YYYY-MM-DD` deletes the server's events read before that London date and stores the date as `reading_since`.
- Every issue response carries `reading_since`. At each sync the plugin stores it and drops reading-log entries read before it (by the day read, or the issue date for entries older than that field).
- `POST /api/events` accepts events read before `reading_since` (they are listed in `accepted`, so the Kindle stops resending them) but does not store them.
- Hiding a story is not a reset: reading that already happened still counts on both sides.

### `GET /issues/{date}/v{version}/{position}.html`

`text/html; charset=utf-8`, standalone story page (DESIGN 4.8). Served for hidden stories too (a device may already have it), but clients should not show them.

With `?photo=1`, and when the story has a photo, the page shows it under the headline as `<img src="<story id>.jpg">`: a file the Kindle keeps beside the page (see "Story photos"). Without the query, or without a photo, the page is the plain one.

### `GET /issues/{date}/v{version}/{position}.{jpg|png|webp}`

The story's photo, with its type as `Content-Type`, when the issue payload names it (404 otherwise). Served for hidden stories too. See "Story photos".

### `GET /issues/{date}/v{version}/{position}.kindle.jpg`

The Kindle's copy of the story's photo, `image/jpeg`, made on the first request. 404 when the story has no photo or it cannot be made into one. See "Story photos".

### `POST /api/events`

Request:

```json
{"device_id": "b5c1...", "events": [
  {"client_event_id": "uuid", "story_id": 41, "type": "story_closed", "ts": 1763013600,
   "payload": {"active_seconds": 95, "pages_total": 2, "max_page": 2, "finished": true}}
]}
```

- Optional `profile` and `profile_root`: the paper the client believes the events belong to (from its last issue response). When they name a different paper than this mount serves (the rule under the issue fields), the response is 409 and nothing is stored, so reading never lands in another child's paper. Without them (older clients), events are accepted as before.
- `type` is one of `issue_downloaded`, `list_shown` (payload `{date, version}`, `story_id` null), `story_opened` (payload `{}`), `story_closed` (payload as above), `sport_viewed` (`story_id` null; see "Sport page").
- Response 200: `{"accepted": ["uuid", ...]}` listing every `client_event_id` now stored, including ones that were already stored from an earlier upload. The client deletes exactly those from its queue.
- Unknown `story_id` or unknown `type`: the event is not stored and not in `accepted`; the response is still 200. The client keeps those for at most 7 days, then drops them.
- Max 500 events per request.

### Admin and parent

- `POST /admin/generate[?force=true][&date=YYYY-MM-DD][&profile=<id>]` with header `X-Admin-Token`, at the root of the Kindle port only. 200 `{"date","version","fallback","story_count","status": "created"|"exists"}`. 503 with `"status": "failed"` and a `detail` line when nothing could be published (the CronJob's `curl -f` then marks the job failed). A forced run that fails keeps the existing version.
  - It runs every profile in turn, never two at once. With one profile, or with `?profile=<id>` (which limits it to that one; an unknown id is 404), the response is exactly the shape above. With several, the top-level fields are the root owner's result (the first profile's when none owns the root), plus `"profiles": {"<id>": result, ...}` with each result in the shape above; the status is 503 if any failed, with `detail` naming them.
- `POST /admin/sports` with `X-Admin-Token`, at the root of the Kindle port only, fetches the Sport page now (see "Sport page"): 200 `{status: "ok" | "partial", updated_at, errors}`, or 503 with `status: "failed"` when nothing new could be fetched.
- `GET /healthz` returns 200 `ok`.
- The dashboard and its API are on port 8081 only (see "Parent dashboard").

## Parent-added articles

- **Archive:** every article fetched from a configured feed is kept for 30 days (`articles(url PK, source_name, title, summary, published_at, fetched_at)`), whether or not it was picked. Items matching the feed's exclude patterns (videos, podcasts, quizzes) are not archived.
- **Find:** the dashboard's "Add a story" page (`/find`) searches that archive by keyword (title and summary, newest first) and also accepts a pasted article URL from any site.
- **Add:** each result has "Add to today" and "Add for tomorrow". Adding runs the same extract, rewrite and check steps as the pipeline (DESIGN 4.1 steps 4 to 6); a story that fails is not added and the dashboard shows the reasons. The parent cannot bypass the checks.
  - **Today:** appended to today's issue as a new story with the next free `position`, in the **same** `version`. It appears in `/api/issue/today` at once.
  - **Tomorrow:** stored as a request; the next generation includes it as one of its `story_count` picks and skips it in selection.
- **Device:** when a sync returns the same date and version, any story in `stories` that the device does not have is downloaded and added to the headline list in `position` order.

## Parent dashboard (React PWA)

The dashboard is a separate front end in `web/` (React, TypeScript, Vite, Tailwind, `vite-plugin-pwa`), built to static files and served by the Express server at `/dashboard/` (SPA fallback to `index.html`, service worker scope `/dashboard/`). It talks only to the JSON API below. There are no server-rendered dashboard pages. In development, Vite runs on its own port and proxies `/api/dashboard` to `http://localhost:8081` and the rest of `/api` to `http://localhost:8080`.

### Auth: Authelia in front, or the built-in sign-in

By default the app has no login, password, session or user of its own (see "Built-in sign-in" for the optional one). Access control is Authelia on the edge, and the dashboard is only reachable through it:

- **Two ports.** The server listens on `PORT` (8080) for the Kindle routes only (`/api/issue/*`, `/issues/*`, `/api/events`, and the iPad reader's `/read/*` and `/api/reader`, each also under `/p/<id>`, plus `/admin/generate` and `/healthz`), and on `DASHBOARD_PORT` (8081) for the dashboard only (`/dashboard/*`, `/api/dashboard/*`, `/healthz`, and `/login`, `/logout` with the built-in sign-in; `GET /` redirects to `/dashboard/`). Neither port serves the other's routes (404).
- **Exposure.** Port 8080 is the LAN LoadBalancer the Kindle uses. Port 8081 is ClusterIP only and is reached solely through the dashboard's Ingress, on Traefik's `websecure` entrypoint, with TLS from the default TLSStore and an Authelia `forwardAuth` middleware (use a two-factor policy). Plain HTTP is redirected to HTTPS.
- **No identity headers.** The existing middleware does not forward `Remote-User`, so the app does not know or need to know who is signed in.
- **Session expiry.** When the Authelia session expires, an API `fetch` gets a redirect to the Authelia sign-in page instead of JSON. The web app fetches with `redirect: "manual"`; an `opaqueredirect` response (or a 401) means "signed out", and it reloads the page so the browser does the Authelia sign-in, then comes back.
- **CSRF guard.** Every non-GET `/api/dashboard/*` route still requires the header `X-Early-Edition: 1` and returns 403 without it.
- **Local development.** Both ports bind to `127.0.0.1` unless `HOST` is set; there is no auth locally.
- Errors are `{error: "message"}` with a suitable status.

### Built-in sign-in (added 15 November 2026)

For setups with no authenticating proxy, such as a plain `docker run`. Off unless `DASHBOARD_PASSWORD` is set; with it unset the app behaves exactly as above. The Kindle port is never affected.

- **What needs a session.** Everything on the dashboard port except `/healthz`, `GET /login`, `POST /login` and `POST /logout`. Without a valid session, an API request (`/api/...`) or any non-GET gets 401 `{error}`; a page navigation gets 302 to `/login?next=<path>`. `next` is honoured only as a same-origin path under `/dashboard`; anything else signs in to `/dashboard/`.
- **Sign-in page.** `GET /login` is a small server-rendered form in the dashboard's colours, light and dark (not HTTP Basic, so it works as an iOS home-screen app). It asks for the password, and for a user name too when `DASHBOARD_USER` is set. `POST /login` (form fields `user`, `password`, `next`) answers 303 to `next` with the cookie, or the form again with 401. After 5 failed tries in a minute from one connecting address it answers 429 for the rest of that minute (kept in memory). `POST /logout` clears the cookie and answers 303 to `/login`.
- **Cookie.** `eek_session`, stateless: an expiry time and its HMAC-SHA256, keyed by scrypt from the password, the user name and `SESSION_SECRET` (when set), so changing any of them signs everyone out. 30 days, `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the request is https (including `X-Forwarded-Proto: https` from a proxy). Secrets are compared in constant time.
- **Web app.** A 401 means "signed out", as with Authelia: the page reloads once, lands on `/login`, and comes back after signing in. The More page shows "Sign out" (a form post to `/logout`, which also empties the offline caches) when `ProfilesView.login` is true.

### Shapes

```ts
type StoryStats = { opened: boolean; reached_end: boolean; active_seconds: number;
                    expected_seconds: number; min_seconds: number;   // see "Read too fast"
                    too_fast: boolean; engaged: boolean };
type StoryCard = { id: number; date: string; version: number; position: number; topic: string;
                   title: string; teaser: string; minutes: number; word_count: number;
                   hidden: boolean; added_by_parent: boolean; reused: boolean;
                   source_name: string; source_url: string; source_title: string | null;
                   stats: StoryStats };
type StoryDetail = StoryCard & { body_html: string;              // the <body> content he sees, no <html>/<head>
                                 word_to_know: { word: string; definition: string } | null;
                                 think_about_it: string; prev_id: number | null; next_id: number | null;
                                 image: { alt: string | null } | null;     // the photo, at GET /stories/:id/image
                                 checks: StoryChecks | null;               // see "Story checks"
                                 created_at: string };                     // when it was written, UTC ISO
type IssueView = { date: string; version: number; fallback: boolean; created_at: string;
                   downloaded_by: { device: string; version: number; received_at: string }[];
                   read_count: number; stories: StoryCard[] };   // includes hidden ones, flagged
type IssueSummary = { date: string; version: number; fallback: boolean; story_count: number; read_count: number };
type TopicView = { name: string; description: string | null;      // the config's `description`, never its `notes`
                   base_weight: number; effective_weight: number; mode: "pin" | "block" | null;
                   shown: number; opened: number; engaged: number; open_rate: number; engagement_rate: number };
type ArticleHit = { url: string; source_name: string; title: string; summary: string;
                    published_at: string | null; already_used: boolean };
type Job = { id: string; status: "pending" | "done" | "failed"; when: "today" | "tomorrow";
             story: StoryCard | null; reasons: string[] };
type RunView = { started_at: string; finished_at: string | null; date: string; status: string; detail: string[] };
```

### Routes (all under `/api/dashboard`, or `/api/dashboard/p/<id>` for a profile)

`GET /api/dashboard/profiles` (`ProfilesView`, see "Profiles") and `GET /api/dashboard/about` (`AboutView`, see "About this server") are only at the root. Every route below is per profile.

| Method and path | Returns |
|---|---|
| `GET /summary` | `{today: IssueView \| null, streak: number, week_read: number, last_run: RunView \| null}` |
| `GET /issues?limit=30` | `IssueSummary[]`, newest first |
| `GET /issues/:date` | `IssueView` for the latest version of that date, or 404 |
| `GET /stories/:id` | `StoryDetail` |
| `GET /stories/:id/image` | the story's photo (as the iPad shows it), or 404 |
| `POST /stories/:id/hide`, `POST /stories/:id/unhide` | `StoryCard` |
| `POST /regenerate` `{confirm: true}` | the `/admin/generate?force=true` result; 409 `{error}` without `confirm` when a device has already downloaded today's issue |
| `GET /topics` | `TopicView[]`, in config order |
| `POST /topics/:name` `{mode: "pin" \| "block" \| null}` | `TopicView`. `block` keeps the topic out of the paper, `pin` asks for a story from it whenever there is a suitable one, `null` clears either. The Topics page shows `block` as a switch turned off ("5 of 6 on" counts the topics that are not blocked) and `pin` as a separate toggle; a topic has one mode, so turning it off unpins it. |
| `GET /articles/search?q=` | `ArticleHit[]` (max 30). Empty `q` returns the newest 30. |
| `POST /articles/add` `{url, when: "today" \| "tomorrow"}` | 202 `Job` (rewriting takes tens of seconds) |
| `GET /jobs/:id` | `Job`; the web app polls every 2 seconds until it is not `pending` |
| `GET /runs?limit=10` | `RunView[]` |
| `GET /sport?days=14` | `SportUsageView` for the last `days` days (7–120) ending today (see "Sport page") |
| `GET /sport/settings`, `PUT /sport/settings` | `SportSettingsView` (see "Sport page") |

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
                     too_fast: number;   // stories in the range's papers read too fast
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
| `GET /summary` | gains `streak_detail: Streak` and `last_run_cost: RunCost \| null`, `kindle_seen_at: string \| null` (when the Kindle last asked for today's paper or sent reading, UTC ISO), and `catch_up_today: number` (stories from earlier papers read to the end today); existing fields unchanged |
| `GET /day/YYYY-MM-DD` | `DayView`: `{ date, read, minutes, reads: { story: StoryCard; at; active_seconds; finished }[], paper: IssueView \| null }`. `reads` is everything opened that day from any paper, oldest first; `paper` is that day's own paper. 404 for a future date. |
| `GET /reading?days=14` | `ReadingView` for the last `days` days (7–120, default 14) ending today |
| `GET /reading/settings`, `PUT /reading/settings` | `ReadingSettings` `{ min_reading }`; PUT takes `min_reading` (0 to 1, kept to two places) and returns the settings, or 400 `{error}`. See "Read too fast" |
| `GET /calendar?month=YYYY-MM` | `CalendarView` (default this month) |
| `GET /ai` | `AiView` |
| `PUT /ai` `Partial<{writer_model, check_model, writer_effort, check_effort, monthly_limit_usd}>` | `AiView`; 400 `{error}` for a model not offered by the provider, a bad effort, or a negative limit. `monthly_limit_usd: null` removes the limit. Needs `X-Early-Edition: 1`. |

### Reading days and catching up (added 15 November 2026)

- **A reading day is the London date he closed the story on the Kindle** (the event's `ts`, already corrected for clock skew by the plugin), not when the server received it. Events without a `ts` fall back to `received_at`. This dates the streak, the bars, the calendar cells and `/day`.
- **Counts per day are reading, not the paper.** `ReadingDay.read` and calendar `read` count stories finished that day from any paper, so they can exceed that day's `stories`. A day's paper being fully read, whenever it happened, is `all_read`.
- **`StoryStats.read_on`**: the London date he first read the story to the end, or null. The dashboard shows "Read on Sun 15 Nov" when it differs from the paper's date.
- The dashboard's Day screen (`/dashboard/day/:date`, `?view=paper` for the paper) replaces the issue page; `/dashboard/issues/:date` redirects to it.

### Two providers side by side: Anthropic and OpenRouter (added 13 November 2026)

Both providers can be configured at once, and the writer and the checker can each use a model from either.

- **Keys.** `LLM_API_KEY` stays the Anthropic key. `OPENROUTER_API_KEY` (its own Secret, `early-edition-kids-openrouter-key`, read as optional) enables OpenRouter at `https://openrouter.ai/api/v1`. A provider without a key shows `configured: false` and its models can't be chosen.
- **Model ids are namespaced:** `anthropic:claude-opus-5-5`, `openrouter:anthropic/claude-opus-5.5`. Stored settings and `PUT /ai` use these. A bare id (old setting or env) means `anthropic:` when `LLM_PROVIDER` is `anthropic`.
- **OpenRouter models** come from config `openrouter_models: [{id, name, note, input_per_mtok, output_per_mtok}]`. Defaults: `anthropic/claude-opus-5.5` (Claude Opus 5.5 via OpenRouter, 4 / 20), `anthropic/claude-sonnet-5.5` (2 / 10), `moonshotai/kimi-k3.1-pro` (Kimi K3.1 Pro, 2 / 10), `x-ai/grok-4.7` (Grok 4.7, 2 / 6), `z-ai/glm-5.3` (GLM 5.3, 0.08 / 3.60), `deepseek/deepseek-v4-pro-0813` (DeepSeek V4 Pro, 0.11 / 4.44). Only models OpenRouter lists with structured-output support belong here (so not `z-ai/glm-5.3-prime`). Requests use the OpenAI-compatible chat API with `response_format` JSON schema (strict), `reasoning: {effort}` and `usage: {include: true}`; the recorded cost is OpenRouter's reported `usage.cost` when present, else the price table.
- **Shapes:** `ModelOption` gains `provider: "anthropic" | "openrouter"` and its `id` is namespaced. `AiView.models` lists the models of every configured provider. `AiView` gains `providers: { id: "anthropic" | "openrouter"; name: string; description: string; configured: boolean; last_used: string | null }[]`; `name` is "Anthropic" or "OpenRouter", and `description` (added 16 November 2026) is one line for a parent: "Claude models, with your Anthropic key" and "Many models with one key". `AiSettings.provider` now reports the writer model's provider. `RunCost.models` holds namespaced ids.
- **No automatic failover** between providers yet: a call that fails on its provider fails as before (the run uses reserves or the catch-up issue).

### About this server (added 16 November 2026)

`GET /api/dashboard/about` describes the server process itself, so it is only at the root (never under `/p/<id>`) and is the same whichever child is shown. Like every dashboard route it is on the dashboard port only and, with the built-in sign-in, needs a session. It is sent with `Cache-Control: no-store`.

```ts
type AboutView = { version: string;                            // from server/package.json, e.g. "0.2.0"
                   arch: string;                               // Node's process.arch: "arm64", "x64", ...
                   platform: string;                           // Node's process.platform: "linux", "darwin", ...
                   container: "kubernetes" | "docker" | null;  // KUBERNETES_SERVICE_HOST is set; else /.dockerenv exists; else null
                   uptime_seconds: number;                     // whole seconds since the process started
                   sport: { updated_at: string | null; attempted_at: string | null;   // the Sport page's last fetch (added 23 November 2026);
                            error: string | null } | null };   // null when no profile shows the Sport page
```

The Server page shows it as "About this server": Version, Runs on (the container and `arch`, such as "Docker, arm64"; the operating system instead when `container` is null, such as "macOS, arm64") and Running for. When `sport` is set it adds Sport fetched (`updated_at` in London time, or "Not yet") and, when `error` is set and `attempted_at` is not before `updated_at`, Last try: its time, "failed" or, when `attempted_at` equals `updated_at`, "some feeds failed", with the error beneath.

### Share cards (added 14 November 2026)

The Share page turns his reading into a picture to send to family: six cards (Streak, Today, The week, Milestone, Words learned, Ask me about) in a swipeable row, each a 1080 × 1350 PNG in one of three colours (Paper, Green, Night). The cards are drawn in the browser on a canvas, so the server sends only numbers and headlines, and the picture goes nowhere until the parent shares, copies or saves it. The optional name on the cards is typed in the browser and kept in its `localStorage` (`early-edition.share-name`, or `early-edition.share-name.<id>` per child when there are several profiles); it is never sent to the server. `/share?card=<id>` opens on a card.

- **Milestones** count different stories read to the end, ever: 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, then every 100. The card shows the latest one reached and the story that reached it.
- **Words** are the stories' word to know, from stories read in the last 7 days, newest first, one per word, up to 4.
- **Ask me about** uses the stories read today, or else those read on the latest reading day in the last 7 days, up to 3.
- **Only stories read properly** (added 23 November 2026): a story read too fast (see "Read too fast") isn't counted or listed on Today, The week, Milestone, Words learned or Ask me about, and nothing on a card mentions it. Its minutes still count as reading time, and the Streak card is the reading streak as everywhere else.
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

### Story checks (added 16 November 2026)

What the pipeline found when it checked a story (DESIGN 4.3) is kept with the story and shown on the dashboard's story page. Nothing here changes a prompt or adds an LLM call: it is what the pipeline already worked out.

```ts
type StoryChecks = { numbers: { value: string; in_source: boolean }[];   // each number in the title, teaser and body, in order of first use
                     verdict: { safe: boolean; supported: boolean; reasons: string[] };   // the checker's, on the published version
                     attempts: number;                                    // 1, or 2 when the first rewrite was sent back
                     writer_model: string | null;                         // the models that answered: namespaced ids, or "stub"
                     checker_model: string | null };
```

- **Stored** as JSON in `stories.checks` (migration 5). A catch-up story carries its original's. A story made before this, or imported, has `null`: the dashboard then shows no notes for it.
- **`numbers[].value`** is the number as the check compares it, with thousands commas stripped (`"1300"` for "1,300"). A published story's numbers all have `in_source: true`, since one that is not in the source text fails the check.
- **`verdict.reasons`** is what the checker wrote. It is asked for a reason per problem, so a story that passed usually has none.
- **`StoryDetail.created_at`** is when the story was written; for a catch-up story, when its original was.
- **Marks, on the dashboard only.** When a story has checks, `StoryDetail.body_html` wraps each checked number in the headline and the paragraphs in `<mark data-check="number" data-value="1300">1,300</mark>` (`data-value` matches `numbers[].value`), and the bold first use of the word to know in `<mark data-check="word"><b>…</b></mark>`. The reading-time line and the Word to know and Think about it boxes are never marked. Taking the `<mark>` tags out gives exactly the story page's body. The story file, `GET /issues/...` (with or without `?photo=1`) and the issue payload never contain a mark, so the Kindle and the iPad get what they always did.

## Read too fast (added 23 November 2026)

A story read to the end in less than its least reading time was skimmed or paged through: it was **read too fast**. It still counts as read (the tick, "N of M read", the streak), but it isn't engaged and doesn't count toward opening Sport.

- **The least time:** `min_seconds = ceil(word_count / reading_wpm × 60 × min_reading)`. `min_reading` is set per profile on the dashboard's Reading page (`GET`/`PUT /reading/settings`, stored in the `settings` table under `reading`); config.yaml's `min_reading` (formerly `sports.min_reading`, still read) is the starting value, default 0.5. A value set on the Sport page before this setting existed still holds until it is changed.
- **Server:** active time is summed over all of a story's `story_closed` events from every device. `StoryStats.too_fast` is `reached_end && active_seconds < min_seconds`, and `engaged` is now `reached_end && !too_fast` (it was a fixed half of the expected time). `ReadingView.too_fast` counts them in the range's papers.
- **Issue payload:** every story carries `min_seconds`, Sport or not, so a reader marks a story read too fast offline. The readers judge only from their own reading log: a story read on another device, or before the log was kept, is never marked there. The Sport rule's `min_seconds` are the same numbers.
- **On the readers:** the Kindle's All headlines and the iPad's list show a fast-forward mark instead of the read tick, don't grey the story, and say `Read too fast`.

## Story photos (added 16 November 2026)

Both readers show each story's source photo: the iPad as it came, the Kindle (from 16 November 2026) a grey copy under the headline of the story page.

- **Where it comes from.** When a story is made (the pipeline's extract step, a parent-added article, or a rewrite), after it passes its checks, the source article's main image is chosen: the article page's `og:image` (with `og:image:alt`), then `twitter:image`, then the feed item's own image (`media:content`, the widest `media:thumbnail`, or an image `enclosure`). The page is fetched for this only when extraction did not already fetch it.
- **Downloaded once** to the server and stored beside the story file as `issues/<date>/v<version>/<position>.<ext>`. Only `image/jpeg`, `image/png` and `image/webp` are kept, checked by the response type and by the bytes themselves; at most 5 MB, with the same 20-second timeout as page fetches. An image whose alt text has a blocklisted word is skipped. The stored file is never decoded or changed: it is what the iPad shows.
- **The Kindle's copy** is `<position>.kindle.jpg` beside the photo, made with `sharp` (the server's one image library) the first time the Kindle asks for it, and made again if the photo is newer. It is turned upright, cropped to 1000 × 563 around its busiest part, grey, levels stretched and lightly sharpened for e-ink, as a baseline JPEG of about 100 to 200 KB. A photo smaller than 400 × 225, or one that cannot be read, has no Kindle copy (404).
- **On the Kindle.** For a story with `kindle_image`, the plugin downloads that first and saves it as `<story id>.jpg` beside `<story id>.html`, then downloads the story page with `?photo=1`. If the photo answers 404 or anything but a JPEG, it downloads the plain page, so a page never names a file the Kindle does not have. A network failure fails that sync, as a story page's would. Hiding a story deletes its photo too. An older plugin never asks for `?photo=1` and keeps the plain pages.
- **No photo is normal.** A missing or failed image is never an error; the story has `image: null` and every layout holds without it.
- **Stored** in `stories.image_ext`, `image_alt` and `image_url` (migration 4). A catch-up story carries a copy of its source story's photo; a regenerated version downloads its own; a rewritten story keeps its photo unless a new one is found.

## iPad reader (added 16 November 2026)

A home-screen web app for the child (`reader/`, plain TypeScript and Vite), the same paper as the Kindle with photos and colour. Design: `docs/mockups/ipad-reader/`.

- **Where.** Served on the Kindle port only, at `<mount>/read/` for every profile mount (`/read/` for the root owner, `/p/<id>/read/` for each profile); never on the dashboard port. One build serves every mount: its assets and API calls are relative (`../api/issue/today`, `../api/issue/<date>`, `../api/events`, `../api/reader`, and payload paths joined onto the mount). `<mount>/read` redirects to `<mount>/read/`.
- **Home screen.** `<mount>/read/manifest.webmanifest` is written per mount: `name` and `short_name` are the profile's `title`, `start_url` and `scope` are that mount's `read/`, `display: standalone`. The page carries the title as `apple-mobile-web-app-title`, an `apple-touch-icon` (the sunrise mark), and a Content-Security-Policy that allows only the home server. Fonts (Playfair Display, Noto Serif, Noto Sans; OFL) are part of the build. There is no service worker: it would need HTTPS, and the reader runs over plain HTTP on the LAN.
- **No way out.** No links to source sites or to the dashboard; the source is plain text.
- **`GET <mount>/api/reader`** returns `{profile, profile_root, title, mode, age}`: `mode` is the profile's `reader_mode` (`pages` turns pages with no scrolling; `scroll` runs the paper down one long page), `age` its `child_age`, which sets the type size (6 and under, 7 to 8, 9 and over).
- **Reading.** The reader sends the Kindle's events with the same rules: a random `device_id` kept on the iPad; `issue_downloaded` the first time it receives a date and version (today's or a back issue), `list_shown` the first time that front page is shown, `story_opened` and `story_closed` with `active_seconds` (not counting time hidden or asleep, and at most 300 seconds between interactions), `pages_total`, `max_page` and `finished`. In pages, the last page shown counts as the end, as on the Kindle. In the long paper a story counts as opened after two seconds on screen, its "pages" are screens of it, and it is finished when its end comes into view. Events queue on the iPad and go up in batches a few seconds after a story closes and when the reader comes back, with `profile` and `profile_root`; the reader deletes exactly the `accepted` ids and tries again later on a network failure. A story left open when the app was closed is closed with what was measured the next time it starts.
- **On the iPad.** Everything is kept in `localStorage`, each key namespaced by the mount the reader was opened from (`root` or `p:<id>`), since all mounts share one origin: the last papers loaded (shown without the server), which stories were opened and read, the queue, a reading log for My week (stories read this week, the streak, the words to know), and the last Sport page loaded with the day Sport opened (see "Sport page"). It follows the plugin's rules for `reading_since`, for a newer version (taken only if nothing in the kept one was opened) and for a change of paper (everything of the old paper is forgotten).
- **Text size and page colour.** An Aa button in a story's running head opens a panel with six text sizes (a scale on the age band's size, the age band's own in the middle) and three page colours: paper, sepia and night. The choice is kept on the iPad under the profile mount's namespace and applies to the whole reader; changing the size re-lays the pages and keeps the reader on the same words. It is not sent to the server.
- **Checks.** Today's paper is fetched when the reader opens, with Check for news, and when it comes back to the front after 30 minutes or more (or on a new day). A 404 shows "isn't ready yet" with yesterday's paper; an unreachable server keeps showing the last paper loaded.
- **The dashboard's card.** `ProfilesView` gains `kindle_base_url` (the Kindle port as the family's devices reach it, no trailing slash) and `kindle_base_url_derived`. It is `KINDLE_BASE_URL` when set, else `http://<this request's host name>:<PORT>` with `derived: true`. The Devices page shows each child's Kindle server address (`<base>` for the root owner, `<base>/p/<id>` for the others) with the plugin's install steps, and their reader address (that address with `/read/` added) as text and a QR code.

## Sport page (added 23 November 2026)

The Premier League table, the latest matchday's results and the next matchday's fixtures, for a profile with `sports: {enabled: true}`. Design and the reasons behind it: [sports-page.md](sports-page.md).

- **Data.** One file for the server, `$EARLY_EDITION_KIDS_DATA_DIR/sports/premier-league.json`, shared by every profile that shows the page. It holds the last good state and is read at start.
- **When it is fetched.** Once a day: at the start of every `POST /admin/generate` and `GENERATE_AT` run (in the background; it never holds up a paper), and on start when nothing from today has been fetched. A day's fetch that has worked isn't repeated; one with errors is. `POST /admin/sports` fetches at once. Nothing is fetched because a device asked.
- **Sources.** ESPN's site JSON (scores, match summaries, table) and the Fantasy Premier League JSON (rounds, fixtures, the injury list), both free and unofficial. Each part is kept or dropped on its own; a broken part keeps its last good value and is named in the errors.
- **Out of date.** Three days after the last fetch that got the rounds, the page is withdrawn: `/api/sports` answers 404 and the issue's `sports` is `null`.

### `GET <mount>/api/sports`

On the Kindle port, under every mount. 404 when the profile doesn't show the page, or there is nothing current to show. `Cache-Control: no-store`.

```ts
type SportsView = { competition: "Premier League";
                    updated_at: string;                 // when the data was fetched, UTC ISO
                    results_to: string | null;          // London date of the latest played match in `matchday`
                    favourite_team: string | null;      // a Club id: the config's favourite_team, when it names one
                    teams: Club[];
                    matchday: Matchday | null;          // the latest round: the one whose first match kicked off most recently
                    next: Matchday | null;              // the round after it; its matches never have detail
                    table: { final: boolean; rows: TableRow[]; lines: { after: number; label: string }[] } | null;
                    unlock: { needed: number; counted: number; unlocked: boolean } | null };   // today, from every device (see "Read first")
type Club = { id: string; name: string; short: string };   // "man-utd", "Manchester United", "Man Utd"
type Matchday = { number: number; days: { date: string; matches: Match[] }[] };   // London dates, oldest first
type Match = { id: string;                              // stable for the season
               kickoff: string;                         // UTC ISO
               home: string; away: string;              // Club ids
               state: "scheduled" | "finished" | "postponed" | "abandoned";
               score: { home: number; away: number } | null;   // finished only
               goals: Goal[];                           // finished only; players by surname
               detail: MatchDetail | null };            // finished, and its summary fetched
type Side = "home" | "away";
type Goal = { side: Side; player: string; minute: string; kind: "goal" | "penalty" | "own_goal" };   // side: the team it counted for
type Player = { name: string; number: string | null; on: string | null; off: string | null };    // minutes, such as "72'"
type MatchDetail = { goals: Goal[];                                                              // full names
                     penalties: { side: Side; player: string; minute: string; outcome: "missed" | "saved" }[];
                     cards: { side: Side; player: string; minute: string; card: "yellow" | "red" }[];
                     lineups: Record<Side, { starting: { line: "goalkeeper" | "defenders" | "midfielders" | "forwards"; players: Player[] }[];
                                            bench: Player[] }>;
                     subs: { side: Side; minute: string; on: string; off: string; injury: boolean }[];   // injury: went off injured
                     out_injured: Record<Side, string[]> };   // listed injured on the morning of the match, and not in its squad
type TableRow = { position: number; team: string; played: number; won: number; drawn: number;
                  lost: number; goal_difference: number; points: number };
```

- `lines` are where rules are drawn: `{after: 4, label: "Champions League"}` and `{after: 17, label: "Relegation"}`, as the provider marks the places.
- Every word in it is a name, a number or one of these fixed values. Provider text is never passed on; names are plain text of at most 40 characters, and a name the profile's `blocklist` catches is left out.

### Read first

Sport opens after part of today's paper is read properly ([sports-page.md](sports-page.md) 2.7). Set per profile on the dashboard; config.yaml's `sports.read_first` is the starting value. How fast is too fast is the child's reading setting (see "Read too fast").

- **Needed:** `ceil(read_first × stories)`, at least 1, of today's paper's current version without hidden stories. No lock (`unlock: null`) when Sport is off, `read_first` is 0, or there is no paper.
- **Counts:** a story read to the end (any `story_closed` with `finished`, or `max_page >= pages_total`) whose `active_seconds`, summed over all its closes, reach `min_seconds = ceil(word_count / reading_wpm × 60 × min_reading)`. One finished faster is `rushed` (read too fast) and doesn't count; it is still read for every other purpose.
- **The issue's `sports.unlock`** is `{needed, min_seconds: {"<story id>": seconds}}` for that paper's stories, so a reader decides offline from its own reading. **`/api/sports`'s `unlock`** is `{needed, counted, unlocked}` for today from every device's events. A reader opens Sport when either says so, and keeps it open until the London date changes.

### `sport_viewed` events

Sent by a reader when the child leaves a Sport page. `story_id` is null. Payload:

```ts
{ page: "matches" | "table" | "next" | "match";   // the Kindle table's two halves are both "table"
  match_id: string | null;                        // the Match id for "match" (required), else null
  matchday: number | null;
  active_seconds: number }                        // the stories' rules: paused asleep or hidden, at most 300 s between interactions
```

- A page left within 2 seconds is not sent.
- The server stores its own copy of the payload with `match` added: the match's name as it knows it then, such as `"Liverpool 4–0 Man Utd"` (`null` for an unknown match). An event with another page, no `match_id` for a match, a `story_id`, or seconds that are negative or over a day is not stored and not in `accepted`.
- They never count toward read stories, reading days, the streak, minutes, share cards or topic weights. A reading reset deletes them like any other event.

### On the dashboard

```ts
type SportPageUse = { page: "matches" | "table" | "next" | "match";
                      match_id: string | null; match: string | null;   // for "match": which, and its name
                      views: number; seconds: number };
type SportDay = { date: string; views: number; seconds: number; pages: SportPageUse[] };   // per page, and per match; most time first
type SportUsageView = { from: string; to: string; days: SportDay[];   // oldest first, gaps filled with zeros
                        views: number; seconds: number; pages: SportPageUse[] };
```

- `GET /sport?days=14` returns `SportUsageView`. `DayView` gains `sport: SportDay | null` (null on a day with no Sport views). A day is the London date of the event's `ts`, as for reading.
- `GET /sport/settings` returns `SportSettingsView`; `PUT /sport/settings` takes any of `enabled` (boolean) and `read_first` (a number from 0 to 1, kept to two places); `min_reading` is still accepted and sets the reading setting. `settings.min_reading` is the reading setting's value, and returns the same, or 400 `{error}`. Stored in the profile's `settings` table under `sport`; unset values come from the config.
- `DayView` also gains `sport_unlock: UnlockStatus | null`: that day's paper against the current settings.

```ts
type SportSettings = { enabled: boolean; read_first: number; min_reading: number };
type UnlockStory = { id: number; title: string; finished: boolean; active_seconds: number; min_seconds: number;
                     counts: boolean; rushed: boolean };
type UnlockStatus = { needed: number; total: number; counted: number; unlocked: boolean;
                      unlocked_at: string | null;       // when the story that opened it was closed, UTC ISO
                      stories: UnlockStory[] };         // the paper's stories, in order
type SportSettingsView = { settings: SportSettings; today: UnlockStatus | null };
```

## Plugin sync rules (so the server can rely on them)

On start and on resume, the plugin syncs if any of:

1. it is after `earliest_fetch_hour` and it has no issue for today (by the date the server last reported, or the device date if none);
2. there are queued events;
3. it has today's issue and its last successful check was more than 30 minutes ago (this is how hides and new versions reach it).

After a story closes, the plugin also uploads queued events on their own, with no issue fetch: one minute after the last story closed, only if Wi-Fi is already on, and not while another story is open (it waits until that one closes). Going to sleep cancels it; the wake-up sync sends them instead. This keeps the dashboard current within a minute or two of his reading.

A sync uploads events, then fetches `/api/issue/today`. If the date and version match what it has, it applies `hidden` (removes those stories from the headline list and deletes their files, photos included). A higher version replaces the stored issue only if no story from it has been opened.

When today's issue has `sports`, the plugin fetches that path in the same sync, after the issue, and keeps the page and the issue's `sports` field; a 404 there drops what it kept (see "Sport page").

The plugin stores `profile` and `profile_root` from issue responses (today's and back issues) and sends them with its events. When an issue arrives from a different paper (the rule under the issue fields), it first clears its issues, reading log and queued events, then applies the issue as new. An absent `profile` on either side (an older server, or nothing stored yet) changes nothing.
