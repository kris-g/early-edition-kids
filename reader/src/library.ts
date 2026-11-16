// What the iPad keeps of the papers it has loaded, per profile (see storage.ts): the last papers
// (so the reader still has something to show without the server), which stories were opened and
// read, and the bookkeeping behind the issue_downloaded and list_shown events. It follows the
// Kindle plugin's rules (CONTRACT.md "Plugin sync rules" and "Profiles").

import { addDays } from './clock'
import type { Store } from './storage'
import type { Issue, ReaderSettings, StoryBody } from './types'

export interface Paper {
  id: string
  root: boolean
}

/** Which paper (profile data) an issue response is from, or null when the server does not say. */
export function paperOf(issue: Pick<Issue, 'profile' | 'profile_root'>): Paper | null {
  if (typeof issue.profile !== 'string' || !issue.profile) return null
  return { id: issue.profile, root: issue.profile_root === true }
}

/** The root data stays the same paper when its owner's id changes (once, from "default"); otherwise the id decides. */
export function samePaper(a: Paper, b: Paper): boolean {
  if (a.root || b.root) return a.root === b.root
  return a.id === b.id
}

export interface CachedIssue {
  issue: Issue
  /** Story bodies by story id. */
  bodies: Record<string, StoryBody>
  /** Epoch seconds. */
  fetched_at: number
}

/** Papers and their marks are kept this many days back (the Kindle keeps 7 papers). */
export const KEEP_DAYS = 8

type DateMap<T> = Record<string, T>

export class Library {
  private store: Store
  constructor(store: Store) {
    this.store = store
  }

  // ---- papers ----

  private issues(): DateMap<CachedIssue> {
    const m = this.store.get<DateMap<CachedIssue>>('issues', {})
    return m && typeof m === 'object' ? m : {}
  }

  cached(date: string): CachedIssue | null {
    return this.issues()[date] ?? null
  }

  dates(): string[] {
    return Object.keys(this.issues()).sort()
  }

  /**
   * Keep a paper. The same date and version replaces what is kept (hidden and added stories), keeping
   * the bodies already fetched. A newer version replaces a kept one only if nothing in it has been
   * opened, as on the Kindle; an older version never replaces a newer one. Returns what happened.
   */
  putIssue(issue: Issue, now: number): 'new' | 'replaced' | 'updated' | 'kept' {
    const all = this.issues()
    const have = all[issue.date]
    let outcome: 'new' | 'replaced' | 'updated' | 'kept'
    if (!have) outcome = 'new'
    else if (issue.version === have.issue.version) outcome = 'updated'
    else if (issue.version > have.issue.version && !this.anyOpened(issue.date)) outcome = 'replaced'
    else outcome = 'kept'
    if (outcome === 'kept') return outcome
    const bodies: Record<string, StoryBody> = {}
    if (outcome === 'updated') {
      for (const s of issue.stories) if (have!.bodies[s.id]) bodies[s.id] = have!.bodies[s.id]
    } else if (outcome === 'replaced') {
      this.setMap('read', issue.date, [])
      this.setMap('opened', issue.date, [])
    }
    all[issue.date] = { issue, bodies, fetched_at: now }
    this.store.set('issues', all)
    return outcome
  }

  putBody(date: string, id: number, body: StoryBody): void {
    const all = this.issues()
    if (!all[date]) return
    all[date].bodies[id] = body
    this.store.set('issues', all)
  }

  /** The date of the last today's paper loaded. */
  currentDate(): string | null {
    return this.store.get<string | null>('current', null)
  }

  setCurrent(date: string): void {
    const cur = this.currentDate()
    if (!cur || date >= cur) this.store.set('current', date)
  }

  // ---- marks per date ----

  private getMap<T>(key: string): DateMap<T> {
    const m = this.store.get<DateMap<T>>(key, {})
    return m && typeof m === 'object' ? m : {}
  }

  private setMap<T>(key: string, date: string, value: T): void {
    const m = this.getMap<T>(key)
    m[date] = value
    this.store.set(key, m)
  }

  readIds(date: string): Set<number> {
    return new Set(this.getMap<number[]>('read')[date] ?? [])
  }

  markRead(date: string, id: number): boolean {
    const ids = this.readIds(date)
    if (ids.has(id)) return false
    ids.add(id)
    this.setMap('read', date, [...ids])
    return true
  }

  markOpened(date: string, id: number): void {
    const ids = new Set(this.getMap<number[]>('opened')[date] ?? [])
    if (ids.has(id)) return
    ids.add(id)
    this.setMap('opened', date, [...ids])
  }

  anyOpened(date: string): boolean {
    return (this.getMap<number[]>('opened')[date] ?? []).length > 0
  }

  /** True the first time this date and version is seen (an issue_downloaded event is due). */
  firstSeen(date: string, version: number): boolean {
    if (this.getMap<number>('seen')[date] === version) return false
    this.setMap('seen', date, version)
    return true
  }

  /** True the first time this date and version's front page is shown (a list_shown event is due). */
  firstListed(date: string, version: number): boolean {
    if (this.getMap<number>('listed')[date] === version) return false
    this.setMap('listed', date, version)
    return true
  }

  /** Forget papers and marks older than KEEP_DAYS, but never the current paper. */
  tidy(today: string): void {
    const cutoff = addDays(today, -KEEP_DAYS)
    const keep = (d: string) => d >= cutoff || d === this.currentDate()
    const all = this.issues()
    let changed = false
    for (const d of Object.keys(all)) {
      if (!keep(d)) {
        delete all[d]
        changed = true
      }
    }
    if (changed) this.store.set('issues', all)
    for (const key of ['read', 'opened', 'seen', 'listed']) {
      const m = this.getMap<unknown>(key)
      const dropped = Object.keys(m).filter((d) => !keep(d))
      if (dropped.length) {
        for (const d of dropped) delete m[d]
        this.store.set(key, m)
      }
    }
  }

  // ---- the paper (profile) this mount serves ----

  /**
   * Record which paper an issue came from. When it differs from the one kept, everything of the old
   * paper is forgotten first (papers, marks, reading log, queued events) and true is returned.
   */
  checkPaper(issue: Issue): boolean {
    const seen = paperOf(issue)
    if (!seen) return false
    const stored = this.store.get<Paper | null>('paper', null)
    let changed = false
    if (stored && typeof stored.id === 'string' && !samePaper(stored, seen)) {
      const settings = this.settings()
      this.store.clear()
      if (settings) this.setSettings(settings)
      changed = true
    }
    this.store.set('paper', seen)
    return changed
  }

  paper(): Paper | null {
    return this.store.get<Paper | null>('paper', null)
  }

  // ---- small things ----

  readingSince(): string | null {
    return this.store.get<string | null>('since', null)
  }

  setReadingSince(since: string | null): void {
    this.store.set('since', since)
  }

  settings(): ReaderSettings | null {
    return this.store.get<ReaderSettings | null>('settings', null)
  }

  setSettings(s: ReaderSettings): void {
    this.store.set('settings', s)
  }

  /** Epoch seconds of the last time today's paper was asked for and the server answered. */
  lastCheck(): number {
    return this.store.get<number>('last_check', 0)
  }

  setLastCheck(at: number): void {
    this.store.set('last_check', at)
  }
}
