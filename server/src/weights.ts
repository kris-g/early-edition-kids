/** Reading signals, topic weighting and streak (DESIGN 4.4, 4.9). */

import type { Config } from "./config.js";
import { loadsJson, type Database } from "./db.js";
import { readingSettings } from "./reading.js";
import { addDays } from "./timeutil.js";

export const WINDOW_DAYS = 14;

export const expectedSeconds = (wordCount: number, wpm: number) => (wordCount / Math.max(1, wpm)) * 60;

/** The least active time for a story to count as read properly: `minReading` of its expected time, in whole seconds. */
export const minSecondsFor = (wordCount: number, wpm: number, minReading: number) => Math.ceil(expectedSeconds(wordCount, wpm) * minReading);

/** Python-compatible round half to even, so minutes match the original server. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export const minutesFor = (wordCount: number, wpm: number) => Math.max(1, roundHalfEven(wordCount / Math.max(1, wpm)));
export const engagementRate = (engaged: number, shown: number) => (engaged + 1) / (shown + 2);
export const effectiveWeight = (base: number, rate: number) => base * (0.5 + rate);

export interface StoryStat {
  id: number;
  issueDate: string;
  issueVersion: number;
  position: number;
  topic: string;
  title: string;
  teaser: string;
  sourceUrl: string;
  sourceName: string;
  wordCount: number;
  hidden: boolean;
  reusedFrom: number | null;
  addedBy: string | null;
  currentVersion: boolean;
  shown: boolean;
  opened: boolean;
  finished: boolean;
  activeSeconds: number;
  expectedSeconds: number;
  /** The least active time for it to count as read properly (reading.ts). */
  minSeconds: number;
  /** Read to the end, but in less than minSeconds: skimmed or paged through. */
  tooFast: boolean;
  /** Read to the end, and not too fast. */
  engaged: boolean;
  /** Seconds since the epoch when he first read it to the end (the Kindle's time), or null. */
  finishedAt: number | null;
  hasEvents: boolean;
}

export interface TopicStat {
  name: string;
  baseWeight: number;
  notes: string;
  description: string | null;
  mode: string | null;
  shown: number;
  opened: number;
  engaged: number;
  rate: number;
  weight: number;
  openRate: number | null;
}

const toInt = (v: unknown): number | null => {
  if (typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Per-story signals for stories matching `where` (default: issues dated within the last `days` days). */
export function storyStats(
  db: Database,
  config: Config,
  today: string,
  opts: { days?: number; date?: string; ids?: number[] } = {},
): StoryStat[] {
  let rows;
  if (opts.ids) {
    if (!opts.ids.length) return [];
    rows = db.query(`SELECT * FROM stories WHERE id IN (${opts.ids.map(() => "?").join(",")})`, opts.ids);
  } else if (opts.date) {
    rows = db.query("SELECT * FROM stories WHERE issue_date = ? ORDER BY issue_version DESC, position", [opts.date]);
  } else {
    const days = opts.days ?? WINDOW_DAYS;
    rows = db.query(
      "SELECT * FROM stories WHERE issue_date BETWEEN ? AND ? ORDER BY issue_date DESC, issue_version DESC, position",
      [addDays(today, -(days - 1)), today],
    );
  }
  if (!rows.length) return [];
  const minReading = readingSettings(db, config).min_reading;

  const dates = [...new Set(rows.map((r) => r.issue_date as string))];
  const current = new Map<string, number>();
  for (const r of db.query(`SELECT date, version FROM issues WHERE date IN (${dates.map(() => "?").join(",")})`, dates)) {
    current.set(r.date, Number(r.version));
  }

  const shownVersions = new Set<string>();
  for (const ev of db.query("SELECT payload_json FROM events WHERE type = 'list_shown'")) {
    const p = loadsJson<Record<string, any>>(ev.payload_json, {}) ?? {};
    if (typeof p.date === "string") shownVersions.add(`${p.date}|${toInt(p.version) ?? "*"}`);
  }

  const ids = rows.map((r) => Number(r.id));
  const eventsByStory = new Map<number, Array<Record<string, any>>>();
  for (const ev of db.query(
    `SELECT story_id, type, ts, payload_json FROM events WHERE story_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  )) {
    const sid = Number(ev.story_id);
    if (!eventsByStory.has(sid)) eventsByStory.set(sid, []);
    eventsByStory.get(sid)!.push(ev);
  }

  return rows.map((r) => {
    const s: StoryStat = {
      id: Number(r.id),
      issueDate: r.issue_date,
      issueVersion: Number(r.issue_version),
      position: Number(r.position),
      topic: r.topic,
      title: r.title,
      teaser: r.teaser,
      sourceUrl: r.source_url,
      sourceName: r.source_name,
      wordCount: Number(r.word_count),
      hidden: Boolean(r.hidden),
      reusedFrom: r.reused_from === null ? null : Number(r.reused_from),
      addedBy: r.added_by ?? null,
      currentVersion: current.get(r.issue_date) === Number(r.issue_version),
      shown: false,
      opened: false,
      finished: false,
      activeSeconds: 0,
      expectedSeconds: expectedSeconds(Number(r.word_count), config.readingWpm),
      minSeconds: minSecondsFor(Number(r.word_count), config.readingWpm, minReading),
      tooFast: false,
      engaged: false,
      finishedAt: null,
      hasEvents: false,
    };
    const evs = eventsByStory.get(s.id) ?? [];
    s.hasEvents = evs.length > 0;
    for (const ev of evs) {
      if (ev.type === "story_opened" || ev.type === "story_closed") s.opened = true;
      if (ev.type === "story_closed") {
        const p = loadsJson<Record<string, any>>(ev.payload_json, {}) ?? {};
        s.activeSeconds += Math.max(0, toInt(p.active_seconds) ?? 0);
        let finished = p.finished === true;
        const total = toInt(p.pages_total) ?? 0;
        const max = toInt(p.max_page) ?? 0;
        if (total > 0 && max >= total) finished = true;
        s.finished = s.finished || finished;
        const at = toInt(ev.ts);
        if (finished && at !== null && (s.finishedAt === null || at < s.finishedAt)) s.finishedAt = at;
      }
    }
    const listed = shownVersions.has(`${s.issueDate}|${s.issueVersion}`) || shownVersions.has(`${s.issueDate}|*`);
    // A hidden story leaves the device's list, so it only counts if he opened it anyway.
    s.shown = s.opened || (listed && !s.hidden);
    s.tooFast = s.finished && s.activeSeconds < s.minSeconds;
    s.engaged = s.opened && s.finished && !s.tooFast;
    return s;
  });
}

export function topicStats(config: Config, overrides: Record<string, string>, stats: StoryStat[]): TopicStat[] {
  const topics = new Map<string, TopicStat>();
  for (const t of config.topics) {
    topics.set(t.name, {
      name: t.name,
      baseWeight: t.baseWeight,
      notes: t.notes,
      description: t.description,
      mode: overrides[t.name] ?? null,
      shown: 0,
      opened: 0,
      engaged: 0,
      rate: 0.5,
      weight: 0,
      openRate: null,
    });
  }
  for (const s of stats) {
    const t = topics.get(s.topic);
    if (!t || !s.shown) continue;
    t.shown++;
    t.opened += Number(s.opened);
    t.engaged += Number(s.engaged);
  }
  for (const t of topics.values()) {
    t.rate = engagementRate(t.engaged, t.shown);
    t.weight = effectiveWeight(t.baseWeight, t.rate);
    t.openRate = t.shown ? t.opened / t.shown : null;
  }
  // Overrides beat the maths: pinned topics rank with the top weight, blocked ones drop to 0.
  const unblocked = [...topics.values()].filter((t) => t.mode !== "block").map((t) => t.weight);
  const top = unblocked.length ? Math.max(...unblocked) : 0;
  for (const t of topics.values()) {
    if (t.mode === "block") t.weight = 0;
    else if (t.mode === "pin") t.weight = Math.max(t.weight, top);
  }
  return [...topics.values()];
}

/**
 * Consecutive issue days with at least one engaged story, ending today (or yesterday if nothing
 * has been engaged yet today, so the streak is not broken before the day is out).
 */
export function streak(stats: StoryStat[], today: string): number {
  const days = new Set(stats.filter((s) => s.engaged).map((s) => s.issueDate));
  let day = days.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (days.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

/** Streak over a long window so it is not capped at 14 days. */
export function fullStreak(db: Database, config: Config, today: string): number {
  return streak(storyStats(db, config, today, { days: 366 }), today);
}
