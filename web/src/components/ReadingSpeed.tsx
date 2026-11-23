import { useState } from 'react'
import { messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { ReadingSettings } from '../api/types'
import { percent, plural } from '../lib/format'
import { useApi } from '../lib/useApi'
import { Card, ErrorNote, SectionTitle, Segment, Spinner } from './ui'

/** The choices offered; a value set in the config that isn't one of them shows as a percentage. */
const MIN_READING = [
  { value: 0, label: 'Any', name: 'Any' },
  { value: 0.25, label: '¼', name: 'A quarter' },
  { value: 0.5, label: '½', name: 'Half' },
  { value: 0.75, label: '¾', name: 'Three quarters' },
]

function minReadingLine(s: ReadingSettings): string {
  if (s.min_reading <= 0) return 'Any story read to the end counts as read properly, however quickly.'
  return `A story read to the end in less than ${percent(s.min_reading)} of the time it should take was paged through: it is read too fast. It still shows as read, but isn't engaged and doesn't count toward opening Sport.`
}

/**
 * "Not too fast", for this child: how quickly a story can be read and still count as read
 * properly, and how many in the range were read too fast.
 */
export function ReadingSpeed({ tooFast, days }: { tooFast: number | null; days: number }) {
  const view = useApi('reading-settings', (signal) => api.readingSettings(signal))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = view.data

  async function change(min_reading: number) {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.putReadingSettings({ min_reading })
      view.mutate(() => updated)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card label="Not too fast" className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <SectionTitle>Not too fast</SectionTitle>
          <span className="text-[13px] text-muted">{s ? minReadingLine(s) : ' '}</span>
        </div>
        {busy && <Spinner className="text-muted" />}
      </div>
      {view.error && <ErrorNote onRetry={view.reload}>{view.error.message}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {s && (
        <div role="group" aria-label="Least reading time for a story to count" className="grid grid-cols-4 gap-1.5">
          {MIN_READING.map((c) => (
            <Segment key={c.value} aria-label={c.name} pressed={s.min_reading === c.value} disabled={busy} onClick={() => void change(c.value)} className="text-base">
              {c.label}
            </Segment>
          ))}
        </div>
      )}
      {tooFast !== null && (
        <p className="m-0 text-sm">
          {tooFast > 0 ? (
            <>
              <strong className="text-warm">{plural(tooFast, 'story', 'stories')}</strong> read too fast in the last {days} days.
            </>
          ) : (
            `None read too fast in the last ${days} days.`
          )}
        </p>
      )}
    </Card>
  )
}
