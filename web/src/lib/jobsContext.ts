import { createContext, useContext } from 'react'
import type { AddWhen } from '../api/routes'
import type { Job } from '../api/types'

export type JobEntry = {
  url: string
  when: AddWhen
  /** starting: POST in flight; pending: polling; error: the POST or the polling itself failed. */
  phase: 'starting' | 'pending' | 'done' | 'failed' | 'error'
  job?: Job
  error?: string
}

export type JobsCtx = {
  entries: Record<string, JobEntry>
  add: (url: string, when: AddWhen) => void
  dismiss: (url: string) => void
}

export const JobsContext = createContext<JobsCtx | null>(null)

export function useJobs(): JobsCtx {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used inside <JobsProvider>')
  return ctx
}
