import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type EventsBody } from './api'
import { EventQueue } from './events'
import { Store, memoryKV } from './storage'
import { Uploader } from './uploader'

afterEach(() => vi.useRealTimers())

describe('sending reading', () => {
  it('sends the queue with the paper, deletes what was accepted, and tries again later on a network failure', async () => {
    vi.useFakeTimers()
    let n = 0
    const queue = new EventQueue(new Store(memoryKV(), 'root'), () => `id-${++n}`)
    queue.add('story_opened', 41, {}, 1)
    queue.add('story_closed', 41, { finished: true }, 2)
    const bodies: EventsBody[] = []
    let fail = true
    const up = new Uploader({
      queue,
      deviceId: 'dev',
      paper: () => ({ id: 'younger', root: false }),
      post: async (body) => {
        bodies.push(body)
        if (fail) throw new ApiError('network', 0, 'offline')
        return { accepted: ['id-1', 'id-2'] }
      },
    })
    expect(await up.flush()).toBe('network')
    expect(queue.count()).toBe(2)
    fail = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(queue.count()).toBe(0)
    expect(bodies.at(-1)).toMatchObject({ device_id: 'dev', profile: 'younger', profile_root: false })
    expect(bodies.at(-1)!.events.length).toBe(2)
    expect(await up.flush()).toBe('empty')
  })
})
