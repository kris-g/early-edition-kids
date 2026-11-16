# Early Edition Kids server

The server half of Early Edition Kids, a daily kids' news brief for a Kindle running KOReader. It fetches four news feeds, has an LLM choose and rewrite about six stories for an 8 year old, checks each one, and serves them as small standalone HTML files to the KOReader plugin. It also serves the JSON API and the built files of the parent dashboard (`../web/`, a React PWA).

Node.js 22+ and TypeScript, run directly with [tsx](https://tsx.is) (no compile step), Express 5, Node's built-in `node:sqlite`, nunjucks for prompts and the story HTML.

The spec is [`docs/DESIGN.md`](../docs/DESIGN.md) (section 4). The interfaces shared with the plugin, the web app and the deploy manifests are in [`docs/CONTRACT.md`](../docs/CONTRACT.md).

## Run it locally

```sh
cd server
npm ci
EARLY_EDITION_KIDS_CONFIG=config.example.yaml \
EARLY_EDITION_KIDS_DATA_DIR=./data \
LLM_BASE_URL=stub \
ADMIN_TOKEN=dev \
npm start
```

`npm start` runs `tsx src/server.ts`, which listens on two ports in one process: 8080 (`PORT`) for the Kindle routes, `/admin/generate` and `/healthz`, and 8081 (`DASHBOARD_PORT`) for the dashboard and its API. Each port 404s the other's routes. Both bind to `127.0.0.1` unless `HOST` is set (the image sets `0.0.0.0`). `npm run dev` does the same with `tsx watch`, restarting on changes.

`LLM_BASE_URL=stub` uses canned LLM replies, so you need no key. The feeds are still fetched from the internet. The stub's stories are placeholder text ("This is a practice story…") with the real headlines.

### Choosing the LLM

Anthropic and OpenRouter can be set up side by side, and the writer and the checker each pick a model from either: model ids are namespaced, `anthropic:claude-opus-5-5` or `openrouter:moonshotai/kimi-k3.1-pro` (a bare id means `anthropic:`). The dashboard's AI settings choose them; `LLM_MODEL` / `CHECK_LLM_MODEL` are the defaults. There is no automatic failover between providers: a call that fails on its provider fails as before (reserves, or the catch-up issue).

**Anthropic (the default choice): Claude Opus 5.5 writes and checks.** Set `LLM_PROVIDER=anthropic` and `LLM_API_KEY` to an Anthropic API key. `LLM_MODEL` and `CHECK_LLM_MODEL` default to `claude-opus-5-5`; `LLM_BASE_URL` is not used. It uses the official `@anthropic-ai/sdk`, and each call:

- leaves thinking on (it is always on for Opus 5.5) and sets its depth with `output_config.effort`: `medium` for choosing and writing, `high` for the safety and fact check (`LLM_EFFORT` and `CHECK_LLM_EFFORT` change them: `low`, `medium`, `high`, `xhigh` or `max`). No `temperature`, `top_p`, `top_k`, thinking budget or assistant prefill is sent;
- asks for structured output (`output_config.format` with a JSON schema, `src/schemas.ts`), so replies are schema-valid; the zod/defensive parsing and the mechanical checks still run afterwards;
- **opts into Anthropic's server-side refusal fallback in its documented default form** on the models that support it (Opus 5.5, Sonnet 5.5; Haiku 5.5 has no server-side fallback, so it is not sent there) (`fallbacks: "default"` with the beta header `server-side-fallback-2026-07-01`): if a safety classifier declines, the API retries the same request on the model Anthropic recommends for that refusal category. If the reply is still a refusal (`stop_reason: "refusal"`), that article is dropped, its `stop_details` category is logged, and a reserve takes its place; it is never published;
- treats `stop_reason: "max_tokens"` (limit 16,000) as a retryable failure, and retries rate limits, 5xx/overloaded and connection errors (2 retries); 400, 401, 403 and 404 are not retried and send the run to the catch-up fallback;
- writes a usage line (model, input and output tokens, stop reason, whether a fallback model served it) into the run detail, which the dashboard's run log shows.

**OpenRouter.** Set `OPENROUTER_API_KEY` (its own Secret, `early-edition-kids-openrouter-key`, optional). The models on offer come from config `openrouter_models` (defaults: Claude Opus 5.5 and Sonnet 5.5, Kimi K3.1 Pro, Grok 4.7, GLM 5.3 and DeepSeek V4 Pro, all via OpenRouter). Requests go to `https://openrouter.ai/api/v1/chat/completions` with a strict JSON-schema `response_format` (the same schemas as the Anthropic path), `reasoning: {effort}`, `usage: {include: true}`, `max_tokens` 16000 and the header `X-Title: Early Edition Kids`. The recorded cost is OpenRouter's own `usage.cost` when it reports one, else the price in `openrouter_models`; the recorded model is the one OpenRouter says answered. `finish_reason: "length"` is retried once; a content filter or refusal drops the story and a reserve takes its place; 429, 5xx and connection errors are retried; 400, 401, 402 and 403 are not, and 402 (out of credit) writes "OpenRouter is out of credit…" into the run log.

**Generic OpenAI-compatible endpoint (back-compat).** `LLM_PROVIDER=openai` (or `LLM_BASE_URL` alone) with `LLM_API_KEY` and a bare `LLM_MODEL`, for example `http://localhost:11434/v1` for Ollama. This path sends plain chat requests, relies on the defensive JSON parsing, and its models can't be changed from the dashboard.

`LLM_BASE_URL=stub` always selects the stub, whatever `LLM_PROVIDER` says.

If you are behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY`.

## Make an issue

```sh
curl -X POST -H 'X-Admin-Token: dev' http://localhost:8080/admin/generate
```

The reply is `{"date", "version", "fallback", "story_count", "status"}`; `status` is `created` or `exists`. With several profiles it makes each one's paper in turn and adds `"profiles": {"<id>": {...}}`; `?profile=<id>` makes just one. It is idempotent per date: a second call returns `exists`. Add `?force=true` for a new version, and `&date=YYYY-MM-DD` for another date.

If no issue could be made (the LLM is down and there are fewer than 3 unopened stories from the last 7 days to reuse, or fewer than `story_count` when it is under 3), the reply is HTTP 503 with `"status": "failed"`. A forced run that fails keeps the existing version.

In the cluster, the CronJob makes this call at 05:30 Europe/London. The pipeline is fully async, so `/healthz` keeps answering while it waits on the LLM. Generation and parent adds share a lock: a second generate call for the same date waits, then returns `exists`.

## Read the output in a browser

- `http://localhost:8080/api/issue/today` is the issue index the Kindle reads. Each story's `path` is its HTML page, for example `http://localhost:8080/issues/2026-11-14/v1/1.html`.
- `http://localhost:8081/dashboard/` is the parent dashboard (`http://localhost:8081/` redirects there). Build it first (`cd ../web && npm ci && npm run build`); the server serves `../web/dist` (or `EARLY_EDITION_KIDS_WEB_DIR`). Without a build, `/dashboard/` says "web app not built". There is no login locally unless `DASHBOARD_PASSWORD` is set.
- `http://localhost:8080/read/` is the child's iPad reader (`/p/<id>/read/` for each profile). Build it first (`cd ../reader && npm ci && npm run build`); the server serves `../reader/dist` (or `EARLY_EDITION_KIDS_READER_DIR`).
- The files are also on disk under `$EARLY_EDITION_KIDS_DATA_DIR/issues/<date>/v<version>/`, with an `index.json` per version, and each story's photo beside its page as `<position>.jpg`, `.png` or `.webp` when it has one.

To see a story as the Kindle will, open its HTML file in the KOReader desktop emulator.

## Dashboard API

All under `/api/dashboard` on the dashboard port (see CONTRACT.md for the shapes; the TypeScript types are in `src/dashboard/types.ts`, which the web app imports):

- With `DASHBOARD_PASSWORD` unset the app has no login, password or session. In the cluster the dashboard port is reachable only through the Ingress that Authelia guards (CONTRACT.md "Auth"); never expose it directly.
- With `DASHBOARD_PASSWORD` set, everything on the dashboard port but `/healthz`, `/login` and `/logout` needs the session cookie from `/login`: the API answers 401 `{error}` without it, and pages redirect to `/login?next=...` (CONTRACT.md "Built-in sign-in").
- `GET /api/dashboard/profiles` lists the profiles. With several, every route below is also at `/api/dashboard/p/<id>/...` for each one, and `/api/dashboard/...` is the root profile's.
- Every non-GET route needs the header `X-Early-Edition: 1` (403 without it), a cheap CSRF guard.
- `GET /api/dashboard/about` (the server's version, what it runs on and its uptime; only at the root, not per profile).
- `GET /summary`, `/issues`, `/issues/:date`, `/stories/:id`, `/topics`, `/articles/search?q=`, `/jobs/:id`, `/runs`; `POST /stories/:id/hide|unhide`, `/regenerate`, `/topics/:name`, `/articles/add`.
- Errors are `{error}` with a plain sentence a parent can read.
- Dashboard v2 (CONTRACT.md): `GET /reading?days=14`, `GET /calendar?month=YYYY-MM`, `GET /ai`, `PUT /ai`, and `streak_detail` / `last_run_cost` on `/summary`.

### AI settings, usage and the monthly limit

Every LLM call (all providers, and the stub with plausible token counts at $0) is recorded in `llm_calls` with its run or add-article job, stage, the model that actually answered (a fallback model if one served it), tokens, stop reason and cost from `llm_prices`. The dashboard's AI page can change the writer and checker model (Opus, Sonnet or Haiku 5.5), their effort (low, medium, high) and a monthly limit in dollars. These are stored in the database and override `LLM_MODEL`, `CHECK_LLM_MODEL`, `LLM_EFFORT` and `CHECK_LLM_EFFORT`; a change applies from the next generation or added article, never mid-run. Once this month's cost reaches the limit, a generation skips the LLM and publishes the catch-up issue ("monthly AI limit reached" in the run log), and adding articles is refused.

```sh
curl localhost:8081/api/dashboard/summary
curl -X POST -H 'X-Early-Edition: 1' -H 'Content-Type: application/json' -d '{"mode":"pin"}' localhost:8081/api/dashboard/topics/Space
```

### Parent-added articles

Every item fetched from a feed is kept for 30 days in the `articles` table (searched with SQLite FTS5, or `LIKE` if the build lacks it). The dashboard searches it, or takes a pasted link from any site, and offers:

- **Add to today:** runs extract, rewrite and check now (a background job the web app polls), then appends the story to today's issue in the same version at the next position. It appears in `/api/issue/today` at once.
- **Add for tomorrow:** checks the page can be read, then saves a request. The next generation uses it as one of its picks (and skips it in selection); the run marks it `added` or `failed` with reasons.

A story that fails the checks is never added. Parent-added stories are marked `added_by = 'parent'`.

## Configuration

Environment variables (secrets never go in the YAML file):

| Variable | Default | Meaning |
|---|---|---|
| `EARLY_EDITION_KIDS_DATA_DIR` | `./data` (`/data` in the image) | SQLite database `early-edition-kids.db` and the `issues/` story files |
| `EARLY_EDITION_KIDS_CONFIG` | `./config.yaml` (`/config/config.yaml` in the image) | The YAML config below |
| `EARLY_EDITION_KIDS_WEB_DIR` | `../web/dist` (`/app/web` in the image) | Built dashboard files served at `/dashboard/` |
| `EARLY_EDITION_KIDS_READER_DIR` | `../reader/dist` (`/app/reader` in the image) | Built iPad reader files, served on the Kindle port at `/read/` and `/p/<id>/read/` |
| `KINDLE_BASE_URL` | worked out from the dashboard's address | The Kindle port as the family's devices reach it, such as `http://192.168.1.50:8080`. Only for the dashboard's "Read on an iPad" card (the addresses and QR code). Set it when the dashboard is behind a proxy on another host name. |
| `LLM_PROVIDER` | `openai` if `LLM_BASE_URL` alone is set | `anthropic` (the provider registry) or `openai` (one generic endpoint) |
| `LLM_BASE_URL` | none | OpenAI-compatible base URL, or `stub` (any provider). Not used for Anthropic. |
| `LLM_API_KEY` | none | Anthropic API key, or the generic endpoint's key |
| `OPENROUTER_API_KEY` | none | Enables OpenRouter models |
| `LLM_MODEL` | `anthropic:claude-opus-5-5` | Default writer model (namespaced; the dashboard can override it) |
| `CHECK_LLM_MODEL` | `LLM_MODEL` | Default checker model, from either provider |
| `LLM_EFFORT` | `medium` | Effort for choosing and writing (Anthropic effort / OpenRouter reasoning effort) |
| `CHECK_LLM_EFFORT` | `high` | Effort for the safety and fact check |
| `GENERATE_AT` | none | `HH:MM`, London time: the server makes the day's paper itself at that time, or at start if it's later and there's no paper yet. For setups with no CronJob, such as a plain `docker run`. |
| `ADMIN_TOKEN` | none | Required header `X-Admin-Token` for `POST /admin/generate`. Unset means the endpoint refuses every call. |
| `PORT` | `8080` | Kindle port |
| `DASHBOARD_PORT` | `8081` | Dashboard port. Without `DASHBOARD_PASSWORD` it has no login, so keep it behind an authenticating proxy or bound to localhost. |
| `DASHBOARD_PASSWORD` | none | Turns on the dashboard's own sign-in page, for setups with no proxy such as Authelia. Unset means no login in the app. |
| `DASHBOARD_USER` | none | With `DASHBOARD_PASSWORD`: also ask for this user name. |
| `SESSION_SECRET` | none | With `DASHBOARD_PASSWORD`: mixed into the sign-in cookie's key. Change it to sign every device out without changing the password. |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the image) | Address both ports bind to |

`config.example.yaml` is the starting config: title, child's age, story count, reading speed, topics with base weights, the four feeds with their exclude patterns (regular expressions, case-insensitive), the blocklist and favourite players. A feed URL may be `file:///path/feed.xml` for offline testing. [docs/settings.md](../docs/settings.md) describes every key for people setting it up.

Optional extra keys, with defaults: `reserves` (4), `max_age_hours` (48), `dedupe_days` (14), `fallback_days` (7), `min_source_words` (150), `source_char_limit` (6000), `llm_concurrency` (3), and `llm_prices` (USD per million input and output tokens per model; defaults Opus 5.5 4 / 20, Sonnet 5.5 2 / 10, Haiku 5.5 0.10 / 0.50).

**Profiles.** For more than one child, add a `profiles:` list (example at the end of `config.example.yaml`; CONTRACT.md "Profiles"). Each entry has an `id` and overrides any other key; lists replace rather than add. Each profile has its own database: the first listed (recorded in `$EARLY_EDITION_KIDS_DATA_DIR/profiles.json`) keeps `early-edition-kids.db` and `issues/`, the others use `profiles/<id>/`. The Kindle routes are at `/p/<id>/` for each, and at `/` for the first. `POST /admin/generate` makes every profile's paper in turn (`?profile=<id>` for one), and the scripts take `--profile <id>`.

Never put the child's name in the config. The LLM sees only his age, topic names and weights, and the favourite players.

## Tuning the prompts

The prompts are nunjucks templates in `prompts/`:

- `editorial_rules.njk`: the skip list, sport and tone rules, included in every prompt
- `select_system.njk`, `select_user.njk`: choosing 6 picks and 4 reserves
- `rewrite_system.njk`, `rewrite_user.njk`: writing one story
- `check_system.njk`, `check_user.njk`: the separate checker call

Edit them and restart the server. In the cluster they are baked into the image. The story page is `templates/story.njk`.

## How a run works

1. Fetch the feeds, archive every item, and keep items dated in the last 48 hours.
2. Drop repeats, non-articles (exclude patterns), blocklisted items and anything used in the last 14 days (by URL and by normalised headline).
3. Parent requests for the date become picks. One select call picks the rest and 4 reserves, weighted by topic.
4. For each pick, take the article text from the feed (`content:encoded`) or fetch the page. Fewer than 150 words: take a reserve.
5. One rewrite call per story, three at a time.
6. Mechanical checks: schema, lengths (title 45, teaser 60, body within `story_words` (120 to 200 in the example config, 100 to 160 if unset) in 3 to 5 paragraphs), topic, `source_url`, every number in the title, teaser and body present in the source, blocklist. Then a separate checker call returns `{safe, supported, reasons}`. A mechanical or "unsupported" failure gets one rewrite with the reasons; a second failure takes a reserve. "Not safe" takes a reserve straight away.
7. Store the issue: database rows, one HTML file per story, `index.json`.
8. If the LLM is unreachable or fewer than 3 stories pass, publish a catch-up issue from unopened stories of the last 7 days, or nothing if fewer than 3 are left. With `story_count` under 3, the bar is `story_count` instead of 3.

## Tests and type checking

```sh
npm test            # vitest, no network, no key
npm run typecheck   # tsc --noEmit
```

The tests use the feed snapshots in `tests/fixtures/` (captured on 13 November 2026), a fake article fetcher and the stub LLM, and they do not need the web build. To refresh the story HTML snapshot after a deliberate change, run `UPDATE_SNAPSHOTS=1 npx vitest run tests/render.test.ts` and review the diff of `tests/snapshots/story.html`.

## Container

The image is built from the repo root so it can include the web app:

```sh
docker build -f server/Dockerfile -t early-edition-kids .
docker run --rm -p 8080:8080 -p 127.0.0.1:8081:8081 -e LLM_BASE_URL=stub -e GENERATE_AT=05:30 early-edition-kids
```

CI publishes the same image as `ghcr.io/kris-g/early-edition-kids` (see the README's getting started).

It runs `node --import tsx src/server.ts` as UID/GID 10001, listens on 8080 (Kindle) and 8081 (dashboard) on `0.0.0.0`, and keeps its data in the `/data` volume. A copy of `config.example.yaml` sits at `/config/config.yaml`; mount your own file (or, on Kubernetes, the ConfigMap) over it. There are no native modules (SQLite is `node:sqlite`), so `docker buildx build --platform linux/amd64,linux/arm64 -f server/Dockerfile .` builds both arches; the web stage runs once on the build machine's arch.

## Backups

`node --import tsx src/backup.ts /data/backup.db` writes a consistent copy of the live database with SQLite's `VACUUM INTO`.

## Admin scripts

The image includes `scripts/`. Run them inside the pod with `kubectl exec`, from `/app`:

- `scripts/rewrite-issues.ts --dates 2026-11-09,2026-11-10 [--dry-run] [--budget 5]` rewrites existing papers with the current settings (models, efforts, prompts, `story_words`) as a new version of each date. Hidden stories are dropped, a story that still fails after its retry is carried over unchanged, and each date gets a run and its LLM calls. It refuses a date while a generation for it is running, stops at the monthly limit or the budget (default $5), and never touches reading events. `--dry-run` makes no LLM calls.
- `scripts/import-comparison.ts [--dry-run] <report.json>...` imports clean Opus stories from model comparison reports as past issues.
- `scripts/reset-reading.ts --since YYYY-MM-DD [--dry-run]` resets reading history: deletes reading events from before that London date, and the Kindle drops its own older reading-log entries at its next sync (CONTRACT.md "Reading since"). Use it after testing on the real Kindle.
- `scripts/compare-models.ts` is the model comparison harness (see `Dockerfile.compare` and `deploy/k8s/compare-job.yaml`).

```sh
kubectl -n my-apps exec deploy/early-edition-kids -- \
  node --import tsx scripts/rewrite-issues.ts --dates 2026-11-09,2026-11-10,2026-11-11,2026-11-12,2026-11-13,2026-11-14 --dry-run
```
