import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { card, job } from '../test/fixtures'
import { JOB_POLL_MS, pollJob } from './jobs'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('pollJob', () => {
  it('polls every 2 seconds until the job is done', async () => {
    const done = job({ status: 'done', story: card({ id: 99, added_by_parent: true }) })
    const fetchJob = vi
      .fn()
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(done)
    const onUpdate = vi.fn()
    const p = pollJob('j1', { fetchJob, onUpdate })

    expect(JOB_POLL_MS).toBe(2000)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchJob).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchJob).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchJob).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchJob).toHaveBeenCalledTimes(3)

    await expect(p).resolves.toEqual(done)
    expect(onUpdate).toHaveBeenCalledTimes(3)
    expect(fetchJob).toHaveBeenCalledWith('j1', undefined)

    // and stops: no more calls afterwards
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchJob).toHaveBeenCalledTimes(3)
  })

  it('resolves with the reasons when the job fails', async () => {
    const failed = job({ status: 'failed', reasons: ['Too upsetting for an 8 year old.'] })
    const fetchJob = vi.fn().mockResolvedValueOnce(job()).mockResolvedValueOnce(failed)
    const p = pollJob('j1', { fetchJob })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(p).resolves.toMatchObject({ status: 'failed', reasons: ['Too upsetting for an 8 year old.'] })
  })

  it('rides out a transient network error', async () => {
    const fetchJob = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the server.'))
      .mockResolvedValueOnce(job({ status: 'done' }))
    const p = pollJob('j1', { fetchJob })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(p).resolves.toMatchObject({ status: 'done' })
  })

  it('gives up on a 4xx', async () => {
    const fetchJob = vi.fn().mockRejectedValue(new ApiError(404, 'Unknown job.'))
    const p = pollJob('j1', { fetchJob })
    const assertion = expect(p).rejects.toThrow('Unknown job.')
    await vi.advanceTimersByTimeAsync(2000)
    await assertion
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })

  it('stops when aborted', async () => {
    const ctrl = new AbortController()
    const fetchJob = vi.fn().mockResolvedValue(job())
    const p = pollJob('j1', { fetchJob, signal: ctrl.signal })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(2000)
    ctrl.abort()
    await assertion
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchJob).toHaveBeenCalledTimes(1)
  })
})
