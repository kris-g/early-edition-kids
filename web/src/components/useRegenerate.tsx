import { useState, type ReactNode } from 'react'
import { ApiError, messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { IssueView } from '../api/types'
import { plural } from '../lib/format'
import { ConfirmDialog } from './ConfirmDialog'

type Ask = { title: string; body: string; confirm: boolean; label: string }

const ON_KINDLE: Ask = {
  title: 'Already on the Kindle',
  body: 'Today’s paper has already been downloaded. A new version replaces it on the Kindle only if he has not opened any story yet.',
  confirm: true,
  label: 'Make it again anyway',
}

const AGAIN: Ask = {
  title: 'Make today’s paper again?',
  body: 'Every story is picked, rewritten and checked again. It takes a few minutes.',
  confirm: false,
  label: 'Make it again',
}

/**
 * "Make it again": regenerate today's paper. Asks first; the server answers 409
 * when a device already has today's paper and `confirm` was not sent, and then
 * we ask in our own words and retry with it.
 */
export function useRegenerate(issue: IssueView | null, onDone: () => void) {
  const [ask, setAsk] = useState<Ask | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function run(confirm: boolean) {
    setAsk(null)
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const r = await api.regenerate(confirm)
      const which = r.version ? `version ${r.version}` : 'a new paper'
      setResult(
        r.status === 'exists'
          ? 'Today’s paper already exists, nothing changed.'
          : `Made ${which} with ${plural(r.story_count, 'story', 'stories')}${r.fallback ? ' (a catch-up paper)' : ''}.`,
      )
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setAsk(ON_KINDLE)
      else if (err instanceof ApiError && err.status === 503)
        setError(`The run could not make a new paper, so nothing changed. ${err.message}`)
      else setError(messageOf(err))
    } finally {
      setRunning(false)
    }
  }

  function start() {
    if (!issue) return void run(false)
    setAsk(issue.downloaded_by.length > 0 ? ON_KINDLE : AGAIN)
  }

  const dialog: ReactNode = ask ? (
    <ConfirmDialog
      title={ask.title}
      confirmLabel={ask.label}
      onConfirm={() => void run(ask.confirm)}
      onCancel={() => setAsk(null)}
    >
      {ask.body}
    </ConfirmDialog>
  ) : null

  const status: ReactNode = (
    <>
      {running && (
        <p role="status" className="text-sm text-muted">
          Picking, rewriting and checking stories. This can take a few minutes; keep this page open.
        </p>
      )}
      {result && <p className="text-sm font-semibold text-accent">{result}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  )

  return { start, running, dialog, status }
}
