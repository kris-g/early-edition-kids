// Sends queued reading events to the server in batches, as the Kindle does (CONTRACT.md
// "POST /api/events"), a few seconds after a story closes and whenever the reader comes back.
// When the network fails the events stay queued and the upload is tried again later, waiting
// longer each time (up to ten minutes).

import { ApiError, postEvents, type EventsBody } from './api'
import { EVENT_BATCH, EventQueue } from './events'
import type { Paper } from './library'

export type UploadResult = 'empty' | 'ok' | 'network' | 'server'

const FIRST_RETRY_MS = 30_000
const MAX_RETRY_MS = 10 * 60_000
const MAX_BATCHES = 20

export class Uploader {
  private queue: EventQueue
  private deviceId: string
  private paper: () => Paper | null
  private post: (body: EventsBody, keepalive: boolean) => Promise<{ accepted: string[] }>
  private now: () => number
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<UploadResult> | null = null
  private failures = 0

  constructor(opts: {
    queue: EventQueue
    deviceId: string
    paper: () => Paper | null
    post?: (body: EventsBody, keepalive: boolean) => Promise<{ accepted: string[] }>
    now?: () => number
  }) {
    this.queue = opts.queue
    this.deviceId = opts.deviceId
    this.paper = opts.paper
    this.post = opts.post ?? postEvents
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000))
  }

  /** Upload after `delayMs`, unless an earlier upload is already due. */
  schedule(delayMs: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delayMs)
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Send everything queued now. Only one upload runs at a time. */
  flush(keepalive = false): Promise<UploadResult> {
    if (this.running) return this.running
    this.cancel()
    this.running = this.send(keepalive).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async send(keepalive: boolean): Promise<UploadResult> {
    if (this.queue.count() === 0) return 'empty'
    const sent = new Set<string>()
    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = this.queue.nextBatch(EVENT_BATCH, sent)
      if (!batch.length) break
      batch.forEach((e) => sent.add(e.client_event_id))
      const paper = this.paper()
      const body: EventsBody = { device_id: this.deviceId, events: batch.map(EventQueue.toWire) }
      if (paper) {
        body.profile = paper.id
        body.profile_root = paper.root
      }
      try {
        const r = await this.post(body, keepalive)
        this.queue.applyAccepted(batch, r.accepted, this.now())
      } catch (err) {
        const network = !(err instanceof ApiError) || err.kind === 'network'
        // Network trouble: try again later. A server error (or a different paper, 409) keeps the
        // events too; the next issue check sorts out which paper this is.
        this.failures++
        this.schedule(Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.min(this.failures - 1, 5)))
        return network ? 'network' : 'server'
      }
    }
    this.failures = 0
    return 'ok'
  }
}
