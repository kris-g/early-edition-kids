// The event queue (CONTRACT.md "POST /api/events"), as the Kindle plugin keeps it
// (plugin/.../events.lua): events wait in storage and go up in batches. The server answers with
// every client_event_id it now holds, and exactly those are deleted. Events it did not accept
// (an unknown story) are kept for at most 7 days, then dropped.

import type { Store } from './storage'

export type EventType = 'issue_downloaded' | 'list_shown' | 'story_opened' | 'story_closed' | 'sport_viewed'

export interface QueuedEvent {
  client_event_id: string
  story_id: number | null
  type: EventType
  /** Epoch seconds. */
  ts: number
  payload: Record<string, unknown>
  /** Local bookkeeping, not sent. */
  queued_at: number
  rejections: number
}

export interface WireEvent {
  client_event_id: string
  story_id: number | null
  type: EventType
  ts: number
  payload: Record<string, unknown>
}

export const EVENT_MAX_AGE = 7 * 24 * 3600
export const EVENT_MAX_REJECTIONS = 100
export const EVENT_BATCH = 500
export const QUEUE_MAX = 5000

const KEY = 'queue'

export class EventQueue {
  private store: Store
  private makeId: () => string
  constructor(store: Store, makeId: () => string) {
    this.store = store
    this.makeId = makeId
  }

  list(): QueuedEvent[] {
    const l = this.store.get<QueuedEvent[]>(KEY, [])
    return Array.isArray(l) ? l : []
  }

  count(): number {
    return this.list().length
  }

  add(type: EventType, storyId: number | null, payload: Record<string, unknown>, now: number): QueuedEvent {
    const list = this.list()
    const ev: QueuedEvent = {
      client_event_id: this.makeId(),
      story_id: storyId,
      type,
      ts: now,
      payload,
      queued_at: now,
      rejections: 0,
    }
    list.push(ev)
    // A hard cap, should something go badly wrong.
    while (list.length > QUEUE_MAX) list.shift()
    this.store.set(KEY, list)
    return ev
  }

  nextBatch(max = EVENT_BATCH, exclude: Set<string> = new Set()): QueuedEvent[] {
    return this.list()
      .filter((e) => !exclude.has(e.client_event_id))
      .slice(0, max)
  }

  static toWire(ev: QueuedEvent): WireEvent {
    return { client_event_id: ev.client_event_id, story_id: ev.story_id, type: ev.type, ts: ev.ts, payload: { ...ev.payload } }
  }

  /** Apply the server's reply for `sent`: delete the accepted ones, count a rejection for the rest. */
  applyAccepted(sent: QueuedEvent[], accepted: string[], now: number): { accepted: number; dropped: number } {
    const ok = new Set(accepted)
    const wasSent = new Set(sent.map((e) => e.client_event_id))
    const kept: QueuedEvent[] = []
    let nAcc = 0
    let nDrop = 0
    for (const ev of this.list()) {
      if (ok.has(ev.client_event_id)) {
        nAcc++
      } else if (wasSent.has(ev.client_event_id)) {
        ev.rejections = (ev.rejections || 0) + 1
        const expired = ev.rejections >= EVENT_MAX_REJECTIONS || now - (ev.queued_at || ev.ts || now) > EVENT_MAX_AGE
        if (expired) nDrop++
        else kept.push(ev)
      } else {
        kept.push(ev)
      }
    }
    this.store.set(KEY, kept)
    return { accepted: nAcc, dropped: nDrop }
  }

  clear(): void {
    this.store.remove(KEY)
  }
}
