import { ApiError } from '../api/client'
import { api } from '../api/endpoints'
import type { Job } from '../api/types'

export const JOB_POLL_MS = 2000

export type PollOptions = {
  intervalMs?: number
  signal?: AbortSignal
  onUpdate?: (job: Job) => void
  /** Injected for tests; defaults to the API call. */
  fetchJob?: (id: string, signal?: AbortSignal) => Promise<Job>
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Poll `GET /jobs/:id` every 2 seconds until the job is no longer pending.
 * Resolves with the finished job (`done` or `failed`). A transient network error
 * does not end the poll; it tries again on the next tick, up to 5 times in a row.
 */
export async function pollJob(id: string, opts: PollOptions = {}): Promise<Job> {
  const interval = opts.intervalMs ?? JOB_POLL_MS
  const fetchJob = opts.fetchJob ?? api.job
  let failures = 0
  for (;;) {
    await wait(interval, opts.signal)
    let job: Job
    try {
      job = await fetchJob(id, opts.signal)
      failures = 0
    } catch (err) {
      if (opts.signal?.aborted) throw err
      // 4xx (logged out, unknown job) will not fix itself; stop.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err
      failures += 1
      if (failures >= 5) throw err
      continue
    }
    opts.onUpdate?.(job)
    if (job.status !== 'pending') return job
  }
}
