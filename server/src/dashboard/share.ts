/**
 * Data for the dashboard's share cards (CONTRACT.md "Share cards"): one call returns what all six
 * cards need. The cards themselves are drawn in the browser; nothing here leaves the server unless
 * the parent shares a card. No child's name is stored or returned.
 *
 * The cards count and list only stories read properly: one read too fast (CONTRACT.md "Read too
 * fast") isn't on them, so its reads count as not read here, though its minutes still count as
 * reading time. The streak is the reading streak, as everywhere else.
 */

import type { Row } from "../db.js";
import type { Context } from "../pipeline.js";
import { parseWordToKnow } from "../render.js";
import { addDays } from "../timeutil.js";
import { storyStats } from "../weights.js";
import { closedEvents, readingView, type Closed } from "./stats.js";
import type { ShareStory, ShareView } from "./types.js";

/** Story counts worth a card. After the last one, every further 100. */
export const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500];

/** The highest milestone at or below `total`, or null below the first. */
export function milestoneFor(total: number): number | null {
  if (total < MILESTONES[0]) return null;
  const last = MILESTONES.at(-1)!;
  if (total >= last) return last + Math.floor((total - last) / 100) * 100;
  return [...MILESTONES].reverse().find((m) => m <= total)!;
}

export function nextMilestone(reached: number | null): number {
  if (reached === null) return MILESTONES[0];
  return MILESTONES.find((m) => m > reached) ?? reached + 100;
}

const shareStory = (r: Row): ShareStory => ({ id: Number(r.id), topic: r.topic, title: r.title, teaser: r.teaser ?? "" });

/** Distinct story ids read to the end, in the order first finished. */
function readOrder(events: Closed[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const e of events) {
    if (!e.read || seen.has(e.storyId)) continue;
    seen.add(e.storyId);
    out.push(e.storyId);
  }
  return out;
}

export function shareView(ctx: Context, today: string): ShareView {
  const rows = new Map<number, Row>();
  const row = (id: number) => {
    if (!rows.has(id)) {
      const r = ctx.db.getStory(id);
      if (r) rows.set(id, r);
    }
    return rows.get(id);
  };
  const stories = (ids: number[]) => ids.map(row).filter((r): r is Row => r !== undefined).map(shareStory);

  const closed = closedEvents(ctx);
  const readIds = [...new Set(closed.filter((e) => e.read).map((e) => e.storyId))];
  const tooFast = new Set(storyStats(ctx.db, ctx.config, today, { ids: readIds }).filter((s) => s.tooFast).map((s) => s.id));
  const all = closed.map((e) => (e.read && tooFast.has(e.storyId) ? { ...e, read: false } : e));
  const weekFrom = addDays(today, -6);
  const fortnight = readingView(ctx, today, 14);
  const week = readingView(ctx, today, 7);
  // The week card's stories per day, without those read too fast.
  const weekDays = week.days.map((d) => ({ ...d, read: readOrder(all.filter((e) => e.date === d.date)).length }));
  const weekTopics = new Map<string, number>();
  for (const id of readOrder(all.filter((e) => e.date >= weekFrom && e.date <= today))) {
    const r = row(id);
    if (r) weekTopics.set(r.topic, (weekTopics.get(r.topic) ?? 0) + 1);
  }

  // Today
  const todayIds = readOrder(all.filter((e) => e.date === today));
  const issue = ctx.db.getIssue(today);
  const inPaper = issue ? ctx.db.storiesFor(today, Number(issue.version)).filter((s) => !s.hidden).length : 0;

  // Milestone: the Nth different story he finished.
  const everIds = readOrder(all);
  const reached = milestoneFor(everIds.length);
  let milestone: ShareView["milestone"] = null;
  if (reached !== null) {
    const id = everIds[reached - 1];
    const first = all.find((e) => e.read && e.storyId === id)!;
    const r = row(id);
    milestone = { stories: reached, date: first.date, story: r ? shareStory(r) : null, next: nextMilestone(reached) };
  }

  // Words to know, newest read first.
  const weekEvents = all.filter((e) => e.date >= weekFrom && e.date <= today);
  const words: ShareView["words"] = [];
  const seenWords = new Set<string>();
  for (const id of readOrder([...weekEvents].reverse())) {
    const r = row(id);
    const w = r ? parseWordToKnow(r.word_to_know) : null;
    if (!r || !w?.word || seenWords.has(w.word.toLowerCase())) continue;
    seenWords.add(w.word.toLowerCase());
    words.push({ word: w.word, definition: w.definition ?? "", story_title: r.title });
    if (words.length === 4) break;
  }

  // Ask me about: today, or else the latest reading day this week.
  let askDate: string | null = null;
  let askIds: number[] = [];
  for (let d = today; d >= weekFrom; d = addDays(d, -1)) {
    const ids = readOrder(weekEvents.filter((e) => e.date === d));
    if (ids.length) {
      askDate = d;
      askIds = ids.slice(0, 3);
      break;
    }
  }

  const topTopics = ctx.config.topics
    .map((t) => ({ name: t.name, read: weekTopics.get(t.name) ?? 0 }))
    .filter((t) => t.read > 0)
    .sort((a, b) => b.read - a.read)
    .slice(0, 3)
    .map((t) => t.name);

  return {
    today,
    streak: fortnight.streak,
    fortnight: fortnight.days,
    today_read: {
      stories: stories(todayIds),
      minutes: fortnight.days.at(-1)?.minutes ?? 0,
      in_paper: inPaper,
    },
    week: {
      from: week.from,
      to: week.to,
      days: weekDays,
      total_read: weekDays.reduce((n, d) => n + d.read, 0),
      minutes: Math.round(week.days.reduce((n, d) => n + d.minutes, 0) * 10) / 10,
      reading_days: weekDays.filter((d) => d.read > 0).length,
      top_topics: topTopics,
    },
    total_read: everIds.length,
    milestone,
    words,
    ask: { date: askDate, stories: stories(askIds) },
  };
}
