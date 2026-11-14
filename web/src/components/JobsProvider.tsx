import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isAbort, messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { AddWhen } from '../api/routes'
import { pollJob } from '../lib/jobs'
import { JobsContext, type JobEntry } from '../lib/jobsContext'

/**
 * Holds "add this article" jobs at the app level so polling carries on while the
 * parent moves between pages.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, JobEntry>>({})
  const controllers = useRef(new Map<string, AbortController>())

  useEffect(() => {
    const map = controllers.current
    return () => map.forEach((c) => c.abort())
  }, [])

  const patch = useCallback((url: string, change: Partial<JobEntry>) => {
    setEntries((prev) => (prev[url] ? { ...prev, [url]: { ...prev[url], ...change } } : prev))
  }, [])

  const add = useCallback(
    (url: string, when: AddWhen) => {
      controllers.current.get(url)?.abort()
      const ctrl = new AbortController()
      controllers.current.set(url, ctrl)
      setEntries((prev) => ({ ...prev, [url]: { url, when, phase: 'starting' } }))

      void (async () => {
        try {
          let job = await api.addArticle(url, when)
          patch(url, { phase: job.status, job })
          if (job.status === 'pending') {
            job = await pollJob(job.id, {
              signal: ctrl.signal,
              onUpdate: (j) => patch(url, { phase: j.status, job: j }),
            })
          }
        } catch (err) {
          if (isAbort(err)) return
          patch(url, { phase: 'error', error: messageOf(err) })
        } finally {
          if (controllers.current.get(url) === ctrl) controllers.current.delete(url)
        }
      })()
    },
    [patch],
  )

  const dismiss = useCallback((url: string) => {
    controllers.current.get(url)?.abort()
    controllers.current.delete(url)
    setEntries((prev) => {
      const next = { ...prev }
      delete next[url]
      return next
    })
  }, [])

  const value = useMemo(() => ({ entries, add, dismiss }), [entries, add, dismiss])
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}
