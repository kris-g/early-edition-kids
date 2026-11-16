import { describe, expect, it } from 'vitest'
import { EVENT_MAX_AGE, EventQueue } from './events'
import { Store, memoryKV } from './storage'

const queue = () => {
  let n = 0
  return new EventQueue(new Store(memoryKV(), 'root'), () => `id-${++n}`)
}

describe('the event queue', () => {
  it('deletes exactly the accepted ids and keeps the rest', () => {
    const q = queue()
    q.add('list_shown', null, { date: '2026-11-16', version: 1 }, 100)
    q.add('story_opened', 41, {}, 101)
    q.add('story_closed', 41, { active_seconds: 9, pages_total: 2, max_page: 2, finished: true }, 102)
    const sent = q.nextBatch()
    expect(sent.map(EventQueue.toWire)[2]).toEqual({
      client_event_id: 'id-3',
      story_id: 41,
      type: 'story_closed',
      ts: 102,
      payload: { active_seconds: 9, pages_total: 2, max_page: 2, finished: true },
    })
    q.add('story_opened', 42, {}, 103) // arrives while the upload is in flight
    expect(q.applyAccepted(sent, ['id-1', 'id-3'], 110)).toEqual({ accepted: 2, dropped: 0 })
    expect(q.list().map((e) => e.client_event_id)).toEqual(['id-2', 'id-4'])
    expect(q.list()[0].rejections).toBe(1)
    expect(q.list()[1].rejections).toBe(0)
  })

  it('drops an event the server keeps refusing after seven days', () => {
    const q = queue()
    q.add('story_opened', 999, {}, 1000)
    const sent = q.nextBatch()
    expect(q.applyAccepted(sent, [], 1000 + EVENT_MAX_AGE + 1)).toEqual({ accepted: 0, dropped: 1 })
    expect(q.count()).toBe(0)
  })

  it('sends in batches, skipping ones already sent this run', () => {
    const q = queue()
    for (let i = 0; i < 5; i++) q.add('story_opened', i, {}, i)
    const first = q.nextBatch(3)
    expect(first.length).toBe(3)
    expect(q.nextBatch(3, new Set(first.map((e) => e.client_event_id))).map((e) => e.story_id)).toEqual([3, 4])
  })
})
