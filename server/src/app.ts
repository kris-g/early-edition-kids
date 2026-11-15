/**
 * Two Express apps (CONTRACT.md "Auth"): the Kindle app on PORT (device API, story files, admin
 * generate) and the dashboard app on DASHBOARD_PORT (web app and its JSON API). Neither serves the
 * other's routes. Each profile (CONTRACT.md "Profiles") has its own context and database and is
 * mounted at /p/<id>/ on both; the profile that owns the root data is also mounted at the root, so
 * a single-child setup looks exactly as it always has. The dashboard has no login unless
 * DASHBOARD_PASSWORD is set (dashboard/login.ts); otherwise a proxy such as Authelia guards it.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import {
  DEFAULT_PROFILE,
  dbPath,
  isStub,
  issuesDir,
  loadProfiles,
  settingsFromEnv,
  type Config,
  type ProfilesConfig,
  type Settings,
} from "./config.js";
import { migrateStoredModelIds } from "./aisettings.js";
import { dashboardApi } from "./dashboard/api.js";
import { Jobs } from "./dashboard/jobs.js";
import { DashboardLogin } from "./dashboard/login.js";
import type { ProfilesView } from "./dashboard/types.js";
import { webApp } from "./dashboard/static.js";
import { HttpError, safeEqual } from "./http.js";
import { Database, utcnowIso } from "./db.js";
import type { FeedFetcher, PageFetcher } from "./feeds.js";
import type { LLM } from "./llm.js";
import { Mutex, buildContext, resultApi, storyFile, storyPath, type Context, type GenerateResult } from "./pipeline.js";
import { generateAll, resolveProfileLayout, type Profile } from "./profiles.js";
import { markKindleSeen } from "./kindleseen.js";
import { beforeReset, readingSince } from "./readingreset.js";
import { parseWordToKnow, renderStory } from "./render.js";
import { isIsoDate, londonDate } from "./timeutil.js";
import { minutesFor } from "./weights.js";

export const EVENT_TYPES = new Set(["issue_downloaded", "list_shown", "story_opened", "story_closed"]);
const STORY_EVENT_TYPES = new Set(["story_opened", "story_closed"]);
export const MAX_EVENTS = 500;
export { HttpError, safeEqual };

export interface AppOptions {
  settings?: Settings;
  /** One profile, "default" (tests). Without this or `profiles`, the config file is read. */
  config?: Config;
  /** Several profiles (tests). */
  profiles?: ProfilesConfig;
  writer?: LLM;
  checker?: LLM;
  feedFetcher?: FeedFetcher;
  pageFetcher?: PageFetcher;
  clock?: () => Date;
}

/** A profile with its dashboard jobs. */
export interface AppProfile extends Profile {
  jobs: Jobs;
}

export interface EarlyEditionKidsApp {
  /** PORT (8080): Kindle routes, /admin/generate and /healthz only. */
  kindleApp: express.Express;
  /** DASHBOARD_PORT (8081): /dashboard/*, /api/dashboard/* and /healthz only, plus /login and /logout when DASHBOARD_PASSWORD is set. */
  dashboardApp: express.Express;
  /** Every profile, in config order. */
  profiles: AppProfile[];
  /** The root profile's context (or the first profile's when no profile owns the root data). */
  ctx: Context;
  jobs: Jobs;
  close(): void;
}

declare global {
  namespace Express {
    interface Locals {
      clock: () => Date;
    }
  }
}

function baseApp(clock: () => Date): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.locals.clock = clock;
  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });
  return app;
}

function finish(app: express.Express): express.Express {
  app.use((_req, _res, next) => next(new HttpError(404, "Not Found")));
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).set(err.headers).json({ detail: err.detail });
      return;
    }
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      res.status(err.type === "entity.too.large" ? 413 : 422).json({ detail: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ detail: "internal error" });
  });
  return app;
}

/** Build both apps, one context and database per profile (migrations run here). */
export function createApp(opts: AppOptions = {}): EarlyEditionKidsApp {
  const settings = opts.settings ?? settingsFromEnv();
  const parsed: ProfilesConfig =
    opts.profiles ??
    (opts.config ? { profiles: [{ id: DEFAULT_PROFILE, config: opts.config }], explicit: false } : loadProfiles(settings.configPath));
  const layout = resolveProfileLayout(
    settings.dataDir,
    parsed.profiles.map((p) => p.id),
    parsed.explicit,
  );
  if (layout.warning) console.warn(layout.warning);
  // One lock for every profile, so two papers are never made at once.
  const lock = new Mutex();
  const dbs: Database[] = [];
  const profiles: AppProfile[] = parsed.profiles.map(({ id, config }) => {
    const pSettings: Settings = { ...settings, dataDir: layout.dirs.get(id)! };
    mkdirSync(pSettings.dataDir, { recursive: true });
    const db = new Database(dbPath(pSettings));
    db.init();
    dbs.push(db);
    migrateStoredModelIds(pSettings, db);
    mkdirSync(issuesDir(pSettings), { recursive: true });
    const ctx = buildContext(pSettings, config, db, {
      profileId: id,
      profileRoot: id === layout.root,
      lock,
      writer: opts.writer,
      checker: opts.checker,
      feedFetcher: opts.feedFetcher,
      pageFetcher: opts.pageFetcher,
    });
    if (ctx.llmSetupError) console.warn(`LLM not configured: ${ctx.llmSetupError} (generation will use the catch-up fallback)`);
    return { id, title: config.title, root: id === layout.root, ctx, jobs: new Jobs() };
  });
  const clock = opts.clock ?? (() => new Date());
  const main = profiles.find((p) => p.root) ?? profiles[0];
  const login = settings.dashboardPassword
    ? new DashboardLogin({ password: settings.dashboardPassword, user: settings.dashboardUser, secret: settings.sessionSecret, clock })
    : null;
  const kindleApp = finish(kindleRoutes(baseApp(clock), profiles, settings));
  const dashboardApp = finish(dashboardRoutes(baseApp(clock), profiles, clock, settings, login));
  const llm = isStub(settings) ? "stub" : `${settings.llmProvider || "openai"}${settings.llmProvider === "anthropic" ? "" : `@${settings.llmBaseUrl || "unset"}`}`;
  const where = parsed.explicit ? ` profiles=${profiles.map((p) => (p.root ? `${p.id} (root)` : p.id)).join(",")}` : "";
  console.log(
    `Early Edition Kids ready: data=${settings.dataDir} config=${settings.configPath}${where} llm=${llm} fts=${main.ctx.db.ftsEnabled}${login ? " login=on" : ""}`,
  );
  return { kindleApp, dashboardApp, profiles, ctx: main.ctx, jobs: main.jobs, close: () => dbs.forEach((db) => db.close()) };
}

/** The Kindle routes for one profile, relative to where they are mounted (/ or /p/<id>). */
function kindleRouter(ctx: Context): Router {
  const app = Router();
  app.get("/api/issue/today", (req, res) => {
    markKindleSeen(ctx.db, req.app.locals.clock());
    const today = londonDate(req.app.locals.clock());
    const payload = issuePayload(ctx, today);
    if (!payload) throw new HttpError(404, `no issue for ${today} yet`);
    res.json(payload);
  });

  app.get("/api/issue/:date", (req, res) => {
    const date = String(req.params.date);
    if (!isIsoDate(date)) throw new HttpError(404, "not a date");
    const payload = issuePayload(ctx, date);
    if (!payload) throw new HttpError(404, `no issue for ${date}`);
    res.json(payload);
  });

  app.get(/^\/issues\/(\d{4}-\d{2}-\d{2})\/v(\d+)\/(\d+)\.html$/, (req, res) => {
    const params = req.params as unknown as Record<string, string>;
    const [date, version, position] = [params[0], Number(params[1]), Number(params[2])];
    const row = ctx.db.queryOne("SELECT * FROM stories WHERE issue_date = ? AND issue_version = ? AND position = ?", [
      date,
      version,
      position,
    ]);
    if (!row) throw new HttpError(404, "not found");
    const file = storyFile(ctx.settings, date, version, position);
    const html = existsSync(file) ? readFileSync(file, "utf8") : renderStory(row, ctx.config.readingWpm);
    res.set("Content-Type", "text/html; charset=utf-8").send(html);
  });

  app.post("/api/events", express.json({ limit: "5mb" }), (req, res) => {
    markKindleSeen(ctx.db, req.app.locals.clock());
    res.json(ingestEvents(ctx, req.body));
  });
  return app;
}

function kindleRoutes(app: express.Express, profiles: AppProfile[], settings: Settings): express.Express {
  for (const p of profiles) app.use(`/p/${p.id}`, kindleRouter(p.ctx));
  const root = profiles.find((p) => p.root);
  if (root) app.use(kindleRouter(root.ctx));

  app.post("/admin/generate", async (req, res) => {
    if (!settings.adminToken) throw new HttpError(403, "ADMIN_TOKEN is not set on the server");
    const token = req.get("x-admin-token");
    if (!token || !safeEqual(token, settings.adminToken)) throw new HttpError(403, "bad admin token");
    const now = req.app.locals.clock();
    const date = typeof req.query.date === "string" && req.query.date ? req.query.date : null;
    if (date !== null && !isIsoDate(date)) throw new HttpError(422, "date must be YYYY-MM-DD");
    const only = typeof req.query.profile === "string" && req.query.profile ? req.query.profile : null;
    const targets = only === null ? profiles : profiles.filter((p) => p.id === only);
    if (!targets.length) throw new HttpError(404, `no profile ${JSON.stringify(only)}`);
    const results = await generateAll(targets, date ?? londonDate(now), now, parseBool(req.query.force));
    const { status, body } = generateResponse(targets, results);
    res.status(status).json(body);
  });

  return app;
}

/** Failed results carry their last run-log line as `detail`, as the single-profile response always has. */
const resultBody = (r: GenerateResult) =>
  r.status === "failed" ? { ...resultApi(r), detail: r.detail.at(-1) ?? "generation failed" } : resultApi(r);

/**
 * One profile: exactly the single-profile response. Several: the root profile's result (or the
 * first's) at the top, every result under `profiles`, and 503 if any failed.
 */
export function generateResponse(targets: Profile[], results: Map<string, GenerateResult>) {
  const main = targets.find((p) => p.root) ?? targets[0];
  const top = results.get(main.id)!;
  if (targets.length === 1) return { status: top.status === "failed" ? 503 : 200, body: resultBody(top) as Record<string, unknown> };
  const failed = targets.filter((p) => results.get(p.id)!.status === "failed");
  const body: Record<string, unknown> = {
    ...resultApi(top),
    profiles: Object.fromEntries(targets.map((p) => [p.id, resultBody(results.get(p.id)!)])),
  };
  if (failed.length) body.detail = failed.map((p) => `${p.id}: ${results.get(p.id)!.detail.at(-1) ?? "generation failed"}`).join("; ");
  return { status: failed.length ? 503 : 200, body };
}

const notFound = (_req: Request, res: Response) => {
  res.status(404).json({ error: "That could not be found." });
};

function dashboardRoutes(
  app: express.Express,
  profiles: AppProfile[],
  clock: () => Date,
  settings: Settings,
  login: DashboardLogin | null,
): express.Express {
  if (login) {
    app.use(login.routes());
    app.use(login.guard());
  }
  const root = profiles.find((p) => p.root) ?? null;
  app.get("/api/dashboard/profiles", (_req, res) => {
    const body: ProfilesView = {
      profiles: profiles.map((p) => ({ id: p.id, title: p.title })),
      root: root?.id ?? null,
      login: login !== null,
    };
    res.set("Cache-Control", "no-store").json(body);
  });
  for (const p of profiles) app.use(`/api/dashboard/p/${p.id}`, dashboardApi({ ctx: p.ctx, clock, jobs: p.jobs }));
  app.use("/api/dashboard/p", notFound);
  if (root) app.use("/api/dashboard", dashboardApi({ ctx: root.ctx, clock, jobs: root.jobs }));
  else app.use("/api/dashboard", notFound);
  app.get("/", (_req, res) => res.redirect(302, "/dashboard/"));
  app.use("/dashboard", (req, res, next) => {
    if (req.originalUrl === "/dashboard" || req.originalUrl.startsWith("/dashboard?")) {
      res.redirect(301, "/dashboard/" + req.originalUrl.slice("/dashboard".length));
      return;
    }
    next();
  });
  app.use("/dashboard", webApp(settings.webDir));
  return app;
}

export function parseBool(v: unknown): boolean {
  return typeof v === "string" && ["true", "1", "yes", "on", "t", "y"].includes(v.toLowerCase());
}

export function issuePayload(ctx: Context, date: string) {
  const issue = ctx.db.getIssue(date);
  if (!issue) return null;
  const version = Number(issue.version);
  const stories: Array<Record<string, unknown>> = [];
  const hidden: number[] = [];
  for (const r of ctx.db.storiesFor(date, version)) {
    if (r.hidden) {
      hidden.push(Number(r.id));
      continue;
    }
    stories.push({
      id: Number(r.id),
      position: Number(r.position),
      topic: r.topic,
      title: r.title,
      teaser: r.teaser,
      minutes: minutesFor(Number(r.word_count), ctx.config.readingWpm),
      path: storyPath(date, version, Number(r.position)),
      word_to_know: parseWordToKnow(r.word_to_know),
    });
  }
  // Edition number: distinct issue dates up to and including this one (one row per date), so it
  // stays the same when a date is regenerated.
  const number = Number(ctx.db.queryOne("SELECT COUNT(*) AS n FROM issues WHERE date <= ?", [date])?.n ?? 1);
  return {
    date,
    version,
    fallback: Boolean(issue.fallback),
    title: ctx.config.title,
    stories,
    hidden,
    number,
    created_at: issue.created_at,
    // The Kindle drops reading-log entries from before this date (a reset); null when never reset.
    reading_since: readingSince(ctx.db),
    // Which child this paper is for. Story ids restart in each profile's database, so the Kindle
    // starts afresh when the paper comes from different data (CONTRACT.md "Profiles").
    profile: ctx.profileId,
    profile_root: ctx.profileRoot,
  };
}

function asInt(v: unknown): number | null {
  if (typeof v === "boolean") return null;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Whether a Kindle that last saw `profile` (and `profile_root`) has this context's data. Unknown
 * (no profile sent, an older plugin) counts as the same. The root data stays the same paper when its
 * owner's id changes, which happens once: from "default" to the first listed profile.
 */
export function samePaper(ctx: Context, profile: unknown, root: unknown): boolean {
  if (typeof profile !== "string") return true;
  if (root === true || ctx.profileRoot) return root === true && ctx.profileRoot;
  return profile === ctx.profileId;
}

/** Store events idempotently on (device_id, client_event_id); see CONTRACT.md. */
export function ingestEvents(ctx: Context, body: unknown): { accepted: string[] } {
  if (isObj(body) && !samePaper(ctx, body.profile, body.profile_root)) {
    throw new HttpError(409, `these events are for profile ${JSON.stringify(body.profile)}; this address serves profile ${JSON.stringify(ctx.profileId)}`);
  }
  const deviceId = isObj(body) ? body.device_id : undefined;
  const events = isObj(body) ? body.events : undefined;
  if (typeof deviceId !== "string" || !deviceId.trim() || deviceId.length > 128) throw new HttpError(422, "device_id is required");
  if (!Array.isArray(events)) throw new HttpError(422, "events must be a list");
  if (events.length > MAX_EVENTS) throw new HttpError(413, `at most ${MAX_EVENTS} events per request`);

  const wanted = [...new Set(events.filter(isObj).map((e) => asInt(e.story_id)).filter((x): x is number => x !== null))];
  const receivedAt = utcnowIso();
  return ctx.db.transaction(() => {
    const known = new Set<number>();
    if (wanted.length) {
      for (const r of ctx.db.query(`SELECT id FROM stories WHERE id IN (${wanted.map(() => "?").join(",")})`, wanted)) {
        known.add(Number(r.id));
      }
    }
    const insert = ctx.db.db.prepare(
      "INSERT OR IGNORE INTO events (device_id, client_event_id, story_id, type, ts, received_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const submitted: string[] = [];
    // Reading from before a reset is accepted, so the Kindle stops resending it, but not stored.
    const skipped: string[] = [];
    for (const e of events) {
      if (!isObj(e)) continue;
      const ceid = e.client_event_id;
      const type = e.type;
      if (typeof ceid !== "string" || !ceid || ceid.length > 128 || typeof type !== "string" || !EVENT_TYPES.has(type)) continue;
      const storyId = asInt(e.story_id);
      if (e.story_id !== null && e.story_id !== undefined && (storyId === null || !known.has(storyId))) continue;
      if (STORY_EVENT_TYPES.has(type) && storyId === null) continue;
      const payload = e.payload ?? {};
      if (!isObj(payload)) continue;
      if (beforeReset(ctx.db, asInt(e.ts))) {
        skipped.push(ceid);
        continue;
      }
      insert.run(deviceId, ceid, storyId, type, asInt(e.ts), receivedAt, JSON.stringify(payload));
      submitted.push(ceid);
    }
    const unique = [...new Set(submitted)];
    const stored = new Set<string>();
    for (let i = 0; i < unique.length; i += 400) {
      const chunk = unique.slice(i, i + 400);
      for (const r of ctx.db.query(
        `SELECT client_event_id FROM events WHERE device_id = ? AND client_event_id IN (${chunk.map(() => "?").join(",")})`,
        [deviceId, ...chunk],
      )) {
        stored.add(r.client_event_id);
      }
    }
    return { accepted: [...new Set([...unique.filter((c) => stored.has(c)), ...skipped])] };
  });
}
