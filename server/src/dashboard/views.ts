/** Mapping database rows and reading stats to the dashboard API shapes. */

import { loadsJson, type Row } from "../db.js";
import { isImageExt, type Context } from "../pipeline.js";
import { parseWordToKnow, renderStory } from "../render.js";
import { londonDate } from "../timeutil.js";

import { minutesFor, storyStats, type StoryStat, type TopicStat } from "../weights.js";
import type { IssueSummary, IssueView, RunView, StoryCard, StoryDetail, TopicView } from "./types.js";

export function storyCard(ctx: Context, row: Row, stat: StoryStat | undefined): StoryCard {
  return {
    id: Number(row.id),
    date: row.issue_date,
    version: Number(row.issue_version),
    position: Number(row.position),
    topic: row.topic,
    title: row.title,
    teaser: row.teaser,
    minutes: minutesFor(Number(row.word_count), ctx.config.readingWpm),
    word_count: Number(row.word_count),
    hidden: Boolean(row.hidden),
    added_by_parent: row.added_by === "parent",
    reused: row.reused_from !== null && row.reused_from !== undefined,
    source_name: row.source_name,
    source_url: row.source_url,
    source_title: row.source_title ?? null,
    stats: {
      opened: stat?.opened ?? false,
      reached_end: stat?.finished ?? false,
      active_seconds: stat?.activeSeconds ?? 0,
      expected_seconds: Math.round(stat?.expectedSeconds ?? 0),
      engaged: stat?.engaged ?? false,
      read_on: stat?.finishedAt != null ? londonDate(new Date(stat.finishedAt * 1000)) : null,
    },
  };
}

export function cardsFor(ctx: Context, rows: Row[], today: string): StoryCard[] {
  const stats = new Map(storyStats(ctx.db, ctx.config, today, { ids: rows.map((r) => Number(r.id)) }).map((s) => [s.id, s]));
  return rows.map((r) => storyCard(ctx, r, stats.get(Number(r.id))));
}

export function cardById(ctx: Context, id: number, today: string): StoryCard | null {
  const row = ctx.db.getStory(id);
  return row ? cardsFor(ctx, [row], today)[0] : null;
}

/** The <body> content of the story page, exactly what the Kindle renders. */
export function storyBodyHtml(ctx: Context, row: Row): string {
  const html = renderStory(row, ctx.config.readingWpm);
  const m = html.match(/<body>\n?([\s\S]*?)\n?<\/body>/);
  return m ? m[1] : html;
}

export function storyDetail(ctx: Context, id: number, today: string): StoryDetail | null {
  const row = ctx.db.getStory(id);
  if (!row) return null;
  const card = cardsFor(ctx, [row], today)[0];
  const siblings = ctx.db.storiesFor(row.issue_date, Number(row.issue_version));
  const idx = siblings.findIndex((s) => Number(s.id) === id);
  return {
    ...card,
    body_html: storyBodyHtml(ctx, row),
    word_to_know: parseWordToKnow(row.word_to_know),
    think_about_it: row.think_about_it ?? "",
    prev_id: idx > 0 ? Number(siblings[idx - 1].id) : null,
    next_id: idx >= 0 && idx < siblings.length - 1 ? Number(siblings[idx + 1].id) : null,
    image: isImageExt(row.image_ext) ? { alt: row.image_alt ?? null } : null,
  };
}

export function downloadedBy(ctx: Context, date: string): IssueView["downloaded_by"] {
  const out: IssueView["downloaded_by"] = [];
  for (const r of ctx.db.query(
    "SELECT device_id, payload_json, received_at FROM events WHERE type = 'issue_downloaded' ORDER BY received_at",
  )) {
    const p = loadsJson<Record<string, any>>(r.payload_json, {}) ?? {};
    if (p.date === date) {
      out.push({ device: String(r.device_id).slice(0, 8), version: Number(p.version) || 0, received_at: r.received_at });
    }
  }
  return out;
}

export function issueView(ctx: Context, date: string, today: string): IssueView | null {
  const issue = ctx.db.getIssue(date);
  if (!issue) return null;
  const stories = cardsFor(ctx, ctx.db.storiesFor(date, Number(issue.version)), today);
  return {
    date,
    version: Number(issue.version),
    fallback: Boolean(issue.fallback),
    created_at: issue.created_at,
    downloaded_by: downloadedBy(ctx, date),
    read_count: stories.filter((s) => !s.hidden && s.stats.reached_end).length,
    stories,
  };
}

export function issueSummaries(ctx: Context, today: string, limit: number): IssueSummary[] {
  const issues = ctx.db.query("SELECT * FROM issues ORDER BY date DESC LIMIT ?", [limit]);
  if (!issues.length) return [];
  const oldest = issues.at(-1)!.date as string;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86400_000) + 1;
  const stats = storyStats(ctx.db, ctx.config, today, { days: Math.max(days, 1) });
  return issues.map((i) => {
    const cur = stats.filter((s) => s.issueDate === i.date && s.issueVersion === Number(i.version));
    return {
      date: i.date,
      version: Number(i.version),
      fallback: Boolean(i.fallback),
      story_count: cur.filter((s) => !s.hidden).length,
      read_count: cur.filter((s) => !s.hidden && s.finished).length,
    };
  });
}

export function weekRead(ctx: Context, today: string): number {
  return storyStats(ctx.db, ctx.config, today, { days: 7 }).filter((s) => s.finished).length;
}

export function runView(r: Row): RunView {
  return {
    started_at: r.started_at,
    finished_at: r.finished_at ?? null,
    date: r.issue_date,
    status: r.status,
    detail: String(r.detail || "").split("\n").filter(Boolean),
  };
}

export function topicView(t: TopicStat): TopicView {
  return {
    name: t.name,
    description: t.description,
    base_weight: t.baseWeight,
    effective_weight: t.weight,
    mode: t.mode === "pin" || t.mode === "block" ? t.mode : null,
    shown: t.shown,
    opened: t.opened,
    engaged: t.engaged,
    open_rate: t.openRate ?? 0,
    engagement_rate: t.rate,
  };
}

