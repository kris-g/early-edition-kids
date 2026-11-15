/**
 * Two Express apps over one database (CONTRACT.md "Auth"): the Kindle app on PORT (device API, story
 * files, admin generate) and the dashboard app on DASHBOARD_PORT (web app and its JSON API). Neither
 * serves the other's routes. The app has no login: Authelia guards the dashboard at the edge.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import { dbPath, isStub, issuesDir, loadConfig, settingsFromEnv, type Config, type Settings } from "./config.js";
import { migrateStoredModelIds } from "./aisettings.js";
import { dashboardApi } from "./dashboard/api.js";
import { Jobs } from "./dashboard/jobs.js";
import { webApp } from "./dashboard/static.js";
import { HttpError, safeEqual } from "./http.js";
import { Database, utcnowIso } from "./db.js";
import type { FeedFetcher, PageFetcher } from "./feeds.js";
import type { LLM } from "./llm.js";
import { buildContext, generate, resultApi, storyFile, storyPath, type Context } from "./pipeline.js";
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
  config?: Config;
  writer?: LLM;
  checker?: LLM;
  feedFetcher?: FeedFetcher;
  pageFetcher?: PageFetcher;
  clock?: () => Date;
}

export interface EarlyEditionKidsApp {
  /** PORT (8080): Kindle routes, /admin/generate and /healthz only. */
  kindleApp: express.Express;
  /** DASHBOARD_PORT (8081): /dashboard/*, /api/dashboard/* and /healthz only. Authelia guards it at the edge. */
  dashboardApp: express.Express;
  ctx: Context;
  jobs: Jobs;
  close(): void;
}

declare global {
  namespace Express {
    interface Locals {
      ctx: Context;
      clock: () => Date;
    }
  }
}

function baseApp(ctx: Context, clock: () => Date): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.locals.ctx = ctx;
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

/** Build both apps over one database (migrations run here). */
export function createApp(opts: AppOptions = {}): EarlyEditionKidsApp {
  const settings = opts.settings ?? settingsFromEnv();
  const config = opts.config ?? loadConfig(settings.configPath);
  const db = new Database(dbPath(settings));
  db.init();
  migrateStoredModelIds(settings, db);
  mkdirSync(issuesDir(settings), { recursive: true });
  const ctx = buildContext(settings, config, db, {
    writer: opts.writer,
    checker: opts.checker,
    feedFetcher: opts.feedFetcher,
    pageFetcher: opts.pageFetcher,
  });
  if (ctx.llmSetupError) console.warn(`LLM not configured: ${ctx.llmSetupError} (generation will use the catch-up fallback)`);
  const clock = opts.clock ?? (() => new Date());
  const jobs = new Jobs();
  const kindleApp = finish(kindleRoutes(baseApp(ctx, clock), ctx));
  const dashboardApp = finish(dashboardRoutes(baseApp(ctx, clock), ctx, clock, jobs));
  console.log(
    `Early Edition Kids ready: data=${settings.dataDir} config=${settings.configPath} llm=${isStub(settings) ? "stub" : `${settings.llmProvider || "openai"}${settings.llmProvider === "anthropic" ? "" : `@${settings.llmBaseUrl || "unset"}`}`} fts=${db.ftsEnabled}`,
  );
  return { kindleApp, dashboardApp, ctx, jobs, close: () => db.close() };
}

function kindleRoutes(app: express.Express, ctx: Context): express.Express {
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

  app.post("/admin/generate", async (req, res) => {
    if (!ctx.settings.adminToken) throw new HttpError(403, "ADMIN_TOKEN is not set on the server");
    const token = req.get("x-admin-token");
    if (!token || !safeEqual(token, ctx.settings.adminToken)) throw new HttpError(403, "bad admin token");
    const now = req.app.locals.clock();
    const date = typeof req.query.date === "string" && req.query.date ? req.query.date : null;
    if (date !== null && !isIsoDate(date)) throw new HttpError(422, "date must be YYYY-MM-DD");
    const target = date ?? londonDate(now);
    const result = await generate(ctx, target, now, parseBool(req.query.force));
    if (result.status === "failed") {
      res.status(503).json({ ...resultApi(result), detail: result.detail.at(-1) ?? "generation failed" });
      return;
    }
    res.json(resultApi(result));
  });

  return app;
}

function dashboardRoutes(app: express.Express, ctx: Context, clock: () => Date, jobs: Jobs): express.Express {
  app.use("/api/dashboard", dashboardApi({ ctx, clock, jobs }));
  app.get("/", (_req, res) => res.redirect(302, "/dashboard/"));
  app.use("/dashboard", (req, res, next) => {
    if (req.originalUrl === "/dashboard" || req.originalUrl.startsWith("/dashboard?")) {
      res.redirect(301, "/dashboard/" + req.originalUrl.slice("/dashboard".length));
      return;
    }
    next();
  });
  app.use("/dashboard", webApp(ctx.settings.webDir));
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
  };
}

function asInt(v: unknown): number | null {
  if (typeof v === "boolean") return null;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Store events idempotently on (device_id, client_event_id); see CONTRACT.md. */
export function ingestEvents(ctx: Context, body: unknown): { accepted: string[] } {
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
