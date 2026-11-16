// The reading log on the iPad, like the Kindle's (plugin/.../readinglog.lua): one entry per closed
// story, kept for a year, never sent anywhere. My week, its streak and its words come from here,
// so they work without the server. A reading reset on the server (reading_since) drops older entries.

import { addDays, mondayOf, weekRange } from './clock'
import type { Store } from './storage'

export interface LogEntry {
  /** The paper's date. */
  date: string
  story_id: number
  topic: string
  title: string
  active_seconds: number
  finished: boolean
  /** Epoch seconds when it closed. */
  ts: number
  /** The London day it was read on. */
  day: string
  word?: string | null
  definition?: string | null
}

export const LOG_KEEP_DAYS = 366
const KEY = 'log'

export const dayOf = (e: LogEntry) => e.day || e.date

export class ReadingLog {
  private store: Store
  constructor(store: Store) {
    this.store = store
  }

  entries(): LogEntry[] {
    const l = this.store.get<LogEntry[]>(KEY, [])
    return Array.isArray(l) ? l : []
  }

  append(e: LogEntry): void {
    const l = this.entries()
    l.push(e)
    this.store.set(KEY, l)
  }

  /** Drops entries older than a year. Returns how many went. */
  prune(today: string, keepDays = LOG_KEEP_DAYS): number {
    const cutoff = addDays(today, -keepDays)
    const l = this.entries()
    const kept = l.filter((e) => !(typeof e.date === 'string' && e.date < cutoff))
    if (kept.length !== l.length) this.store.set(KEY, kept)
    return l.length - kept.length
  }

  /** Drops entries read before `since` (CONTRACT.md "Reading since"). */
  dropBefore(since: string | null | undefined): number {
    if (typeof since !== 'string') return 0
    const l = this.entries()
    const kept = l.filter((e) => !(dayOf(e) < since))
    if (kept.length !== l.length) this.store.set(KEY, kept)
    return l.length - kept.length
  }

  clear(): void {
    this.store.remove(KEY)
  }
}

/** Consecutive days, ending today or yesterday, with at least one story read to the end. */
export function streak(entries: LogEntry[], today: string): number {
  const days = new Set(entries.filter((e) => e.finished).map(dayOf))
  let d = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(d)) {
    n++
    d = addDays(d, -1)
  }
  return n
}

export interface WeekDay {
  date: string
  /** "M", "T"... */
  letter: string
  name: string
  count: number
  when: 'past' | 'today' | 'future'
}

export interface WeekModel {
  range: string
  days: WeekDay[]
  total: number
  streak: number
  topics: { name: string; n: number }[]
  words: { word: string; definition: string | null }[]
}

const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** My week: Monday to Sunday of this week, from the log only. Counts and a streak, never a score. */
export function myWeek(entries: LogEntry[], today: string): WeekModel {
  const monday = mondayOf(today)
  const sunday = addDays(monday, 6)
  const perDay = new Map<string, Set<number>>()
  const week = new Set<number>()
  const topics = new Map<string, number>()
  const words: WeekModel['words'] = []
  const seenWords = new Set<string>()
  for (const e of entries) {
    const d = dayOf(e)
    if (!e.finished || d < monday || d > sunday) continue
    if (!perDay.has(d)) perDay.set(d, new Set())
    perDay.get(d)!.add(e.story_id)
    if (week.has(e.story_id)) continue
    week.add(e.story_id)
    if (e.topic) topics.set(e.topic, (topics.get(e.topic) ?? 0) + 1)
    const w = (e.word ?? '').trim()
    if (w && !seenWords.has(w.toLowerCase())) {
      seenWords.add(w.toLowerCase())
      words.push({ word: w, definition: e.definition ?? null })
    }
  }
  const days: WeekDay[] = NAMES.map((name, i) => {
    const date = addDays(monday, i)
    return {
      date,
      name,
      letter: name[0],
      count: perDay.get(date)?.size ?? 0,
      when: date < today ? 'past' : date === today ? 'today' : 'future',
    }
  })
  return {
    range: weekRange(monday),
    days,
    total: week.size,
    streak: streak(entries, today),
    topics: [...topics].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
    words,
  }
}
