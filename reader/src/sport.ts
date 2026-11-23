// The Sport page on the iPad (docs/sports-page.md): the last Sport page loaded, kept so it opens
// without the server, and whether it is open yet today. Sport opens after part of today's paper is
// read properly (section 2.7): the rule comes with the paper, and the reading comes from this iPad's
// own reading log, so it works offline. The server's count from every device opens it too, so
// reading on the Kindle opens it here. Once open, it stays open until the day changes.

import type { LogEntry } from './readlog'
import type { Store } from './storage'
import type { Issue, SportsView } from './types'

interface Kept {
  view: SportsView
  /** The London day it was fetched: the server's own count is only believed on that day. */
  day: string
}

export interface LockState {
  /** Sport can be shown now. */
  open: boolean
  needed: number
  /** Stories that count so far, on this iPad or (if more) on the server. */
  counted: number
}

/**
 * Which of a paper's stories count toward opening Sport, from this iPad's reading log: read to the
 * end, and open for at least each story's least time over all its sittings.
 */
export function countedStories(issue: Issue, log: LogEntry[]): Set<number> {
  const rule = issue.sports?.unlock
  if (!rule) return new Set()
  const seconds = new Map<number, number>()
  const finished = new Set<number>()
  for (const e of log) {
    if (e.date !== issue.date || !(String(e.story_id) in rule.min_seconds)) continue
    seconds.set(e.story_id, (seconds.get(e.story_id) ?? 0) + Math.max(0, e.active_seconds))
    if (e.finished) finished.add(e.story_id)
  }
  return new Set([...finished].filter((id) => (seconds.get(id) ?? 0) >= rule.min_seconds[String(id)]))
}

export class SportKeeper {
  private store: Store
  constructor(store: Store) {
    this.store = store
  }

  kept(): Kept | null {
    const k = this.store.get<Kept | null>('sport', null)
    return k && typeof k === 'object' && k.view && typeof k.day === 'string' ? k : null
  }

  view(): SportsView | null {
    return this.kept()?.view ?? null
  }

  put(view: SportsView, day: string): void {
    this.store.set('sport', { view, day })
  }

  /** The server took the page down (Sport turned off, or out of date). */
  drop(): void {
    this.store.remove('sport')
  }

  /**
   * The lock for today, with today's paper. No paper today, or a paper with no lock, means open;
   * a paper with no Sport page has none to open (the caller doesn't show it).
   */
  lock(today: string, issue: Issue | null, log: LogEntry[]): LockState {
    if (this.store.get<string | null>('sportOpen', null) === today) return { open: true, needed: 0, counted: 0 }
    const rule = issue && issue.date === today ? issue.sports?.unlock : null
    if (!rule) return { open: true, needed: 0, counted: 0 }
    const mine = countedStories(issue!, log).size
    const kept = this.kept()
    const server = kept && kept.day === today ? kept.view.unlock : null
    const counted = Math.max(mine, server?.counted ?? 0)
    const open = mine >= rule.needed || server?.unlocked === true
    if (open) this.store.set('sportOpen', today)
    return { open, needed: rule.needed, counted: Math.min(counted, rule.needed) }
  }
}
