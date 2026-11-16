/**
 * The parent dashboard JSON API for one profile, under /api/dashboard/p/<id> (and /api/dashboard for
 * the root profile); CONTRACT.md "Parent dashboard (React PWA)". It is only served on DASHBOARD_PORT,
 * which a proxy such as Authelia, or the built-in sign-in (login.ts), guards.
 */

import { existsSync, readFileSync } from "node:fs";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import { SettingsError, updateAiSettings } from "../aisettings.js";
import { addArticle, searchArchive } from "../articles.js";
import { topicNames } from "../config.js";
import { HttpError } from "../http.js";
import { kindleSeenAt } from "../kindleseen.js";
import { generate, injected, isImageExt, resultApi, storyImageFile, type Context } from "../pipeline.js";
import { CONTENT_TYPES, type ImageExt } from "../images.js";
import { londonDate } from "../timeutil.js";
import { fullStreak, storyStats, topicStats } from "../weights.js";
import { requireHeader } from "./guard.js";
import { shareView } from "./share.js";
import { aiView, calendarView, catchUpToday, dayView, lastRunCost, readingView, streakDetail } from "./stats.js";
import { Jobs } from "./jobs.js";
import type { ArticleHit, Job, Summary, TopicMode } from "./types.js";
import {
  cardById,
  downloadedBy,
  issueSummaries,
  issueView,
  runView,
  storyDetail,
  topicView,
  weekRead,
} from "./views.js";

export interface DashboardDeps {
  ctx: Context;
  clock: () => Date;
  jobs: Jobs;
}

/** "only 87 words..." -> "Only 87 words....", for showing a reason to a parent. */
const sentence = (s: string) => {
  const t = s.trim();
  if (!t) return t;
  const cap = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(cap) ? cap : cap + ".";
};

const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function dashboardApi(deps: DashboardDeps): Router {
  const { ctx, clock, jobs } = deps;
  const router = Router();
  const today = () => londonDate(clock());
  router.use(express.json({ limit: "64kb" }));
  router.use(requireHeader);

  // ---- reading ----
  router.get("/summary", (_req, res) => {
    const t = today();
    const last = ctx.db.queryOne("SELECT * FROM runs ORDER BY id DESC LIMIT 1");
    const body: Summary = {
      today: issueView(ctx, t, t),
      streak: fullStreak(ctx.db, ctx.config, t),
      week_read: weekRead(ctx, t),
      last_run: last ? runView(last) : null,
      streak_detail: streakDetail(ctx, t),
      last_run_cost: lastRunCost(ctx),
      kindle_seen_at: kindleSeenAt(ctx.db),
      catch_up_today: catchUpToday(ctx, t),
    };
    res.json(body);
  });

  // ---- dashboard v2: reading, calendar, AI ----
  router.get("/reading", (req, res) => {
    res.json(readingView(ctx, today(), clampInt(req.query.days, 14, 7, 120)));
  });

  router.get("/calendar", (req, res) => {
    const month = typeof req.query.month === "string" && req.query.month ? req.query.month : today().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "The month must look like 2026-11.");
    res.json(calendarView(ctx, today(), month));
  });

  router.get("/day/:date", (req, res) => {
    const date = String(req.params.date);
    const t = today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > t) throw new HttpError(404, "not a day yet");
    res.json(dayView(ctx, date, t));
  });

  router.get("/share", (_req, res) => {
    res.json(shareView(ctx, today()));
  });

  router.get("/ai", (_req, res) => {
    res.json(aiView(ctx, clock()));
  });

  router.put("/ai", (req, res) => {
    try {
      updateAiSettings(ctx.settings, ctx.db, ctx.config, req.body, injected(ctx));
    } catch (err) {
      if (err instanceof SettingsError) throw new HttpError(400, err.message);
      throw err;
    }
    res.json(aiView(ctx, clock()));
  });

  router.get("/issues", (req, res) => {
    res.json(issueSummaries(ctx, today(), clampInt(req.query.limit, 30, 1, 366)));
  });

  router.get("/issues/:date", (req, res) => {
    const date = String(req.params.date);
    const view = /^\d{4}-\d{2}-\d{2}$/.test(date) ? issueView(ctx, date, today()) : null;
    if (!view) throw new HttpError(404, "There is no issue for that date.");
    res.json(view);
  });

  const storyId = (req: Request) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, "That story could not be found.");
    return id;
  };

  router.get("/stories/:id", (req, res) => {
    const detail = storyDetail(ctx, storyId(req), today());
    if (!detail) throw new HttpError(404, "That story could not be found.");
    res.json(detail);
  });

  // The story's photo, so a parent sees what the iPad shows (CONTRACT.md "Story photos").
  router.get("/stories/:id/image", (req, res) => {
    const row = ctx.db.getStory(storyId(req));
    const file = row && isImageExt(row.image_ext)
      ? storyImageFile(ctx.settings, row.issue_date, Number(row.issue_version), Number(row.position), row.image_ext)
      : null;
    if (!row || !file || !existsSync(file)) throw new HttpError(404, "That story has no photo.");
    res
      .set({ "Content-Type": CONTENT_TYPES[row.image_ext as ImageExt], "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" })
      .send(readFileSync(file));
  });

  for (const [action, hidden] of [
    ["hide", true],
    ["unhide", false],
  ] as const) {
    router.post(`/stories/:id/${action}`, (req, res) => {
      const id = storyId(req);
      if (!ctx.db.setHidden(id, hidden)) throw new HttpError(404, "That story could not be found.");
      res.json(cardById(ctx, id, today()));
    });
  }

  router.post("/regenerate", async (req, res) => {
    const now = clock();
    const t = londonDate(now);
    const issue = ctx.db.getIssue(t);
    if (issue && downloadedBy(ctx, t).length && req.body?.confirm !== true) {
      throw new HttpError(409, "Today's issue is already on the Kindle. Regenerating replaces it only while no story in it has been opened.");
    }
    const result = await generate(ctx, t, now, issue !== undefined);
    if (result.status === "failed") {
      const error = issue
        ? "The new issue could not be made, so the current one was kept. The latest run says why."
        : "No issue could be made today. The latest run says why.";
      res.status(503).json({ ...resultApi(result), error });
      return;
    }
    res.json(resultApi(result));
  });

  // ---- topics ----
  const topics = () => topicStats(ctx.config, ctx.db.topicOverrides(), storyStats(ctx.db, ctx.config, today()));

  router.get("/topics", (_req, res) => {
    res.json(topics().map(topicView));
  });

  router.post("/topics/:name", (req, res) => {
    const name = String(req.params.name);
    if (!topicNames(ctx.config).includes(name)) throw new HttpError(404, "There is no topic with that name.");
    const mode = req.body?.mode as TopicMode | undefined;
    if (mode !== null && mode !== "pin" && mode !== "block") throw new HttpError(422, "Choose pin, block or none for the topic.");
    ctx.db.setTopicOverride(name, mode);
    res.json(topicView(topics().find((t) => t.name === name)!));
  });

  // ---- articles ----
  router.get("/articles/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const hits: ArticleHit[] = searchArchive(ctx, q, 30).map((h) => ({
      url: h.url,
      source_name: h.source_name,
      title: h.title,
      summary: h.summary,
      published_at: h.published_at,
      already_used: h.used_on !== null,
    }));
    res.json(hits);
  });

  router.post("/articles/add", (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    const when = req.body?.when;
    if (!url) throw new HttpError(422, "Choose an article or paste a link first.");
    if (when !== "today" && when !== "tomorrow") throw new HttpError(422, "Choose whether to add it today or tomorrow.");
    const topic = typeof req.body?.topic === "string" ? req.body.topic : undefined;
    const job: Job = jobs.start(when, async (jobId) => {
      const r = await addArticle(ctx, { url, when, topic, now: clock(), jobId });
      return {
        ok: r.ok,
        story: r.storyId ? cardById(ctx, r.storyId, today()) : null,
        reasons: r.ok ? [] : [r.message, ...r.problems.map(sentence)],
      };
    });
    res.status(202).json(job);
  });

  router.get("/jobs/:id", (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job) throw new HttpError(404, "That request could not be found. It may have expired; try adding the article again.");
    res.json(job);
  });

  router.get("/runs", (req, res) => {
    const limit = clampInt(req.query.limit, 10, 1, 100);
    res.json(ctx.db.query("SELECT * FROM runs ORDER BY id DESC LIMIT ?", [limit]).map(runView));
  });

  router.use((_req, _res, next) => next(new HttpError(404, "That could not be found.")));
  router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).set(err.headers).json({ error: err.detail });
      return;
    }
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      res.status(err.type === "entity.too.large" ? 413 : 400).json({ error: err.type === "entity.too.large" ? "That request was too large." : "The request could not be read." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server. Try again in a moment." });
  });

  return router;
}
