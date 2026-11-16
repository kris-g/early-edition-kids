import { useState } from 'react'
import { messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { TopicMode } from '../api/routes'
import type { TopicView } from '../api/types'
import { ChevronDown } from '../components/Icons'
import { Card, ErrorNote, Loading, PageHeader, Spinner, Switch, TogglePill } from '../components/ui'
import { cx } from '../lib/cx'
import { percent } from '../lib/format'
import { useApi } from '../lib/useApi'

function fmtWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(1)
}

/** The line under a topic's name: its state when pinned or off, else what it covers. */
function statusLine(t: TopicView): string | null {
  if (t.mode === 'block') return 'Blocked for this child'
  if (t.mode === 'pin') return 'Pinned'
  return t.description
}

/** A topic is on unless it is blocked; the switch is another face on Block (off = blocked). */
export function Topics() {
  const topics = useApi('topics', (signal) => api.topics(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ name: string; message: string } | null>(null)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  async function setMode(t: TopicView, mode: TopicMode) {
    if (t.mode === mode) return
    setBusy(t.name)
    setError(null)
    try {
      const updated = await api.setTopicMode(t.name, mode)
      topics.mutate((list) => list?.map((x) => (x.name === updated.name ? updated : x)))
    } catch (err) {
      setError({ name: t.name, message: messageOf(err) })
    } finally {
      setBusy(null)
    }
  }

  function toggleDetails(name: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(name)) next.add(name)
      return next
    })
  }

  const list = topics.data ?? []
  const onCount = list.filter((t) => t.mode !== 'block').length
  const scale = Math.max(1, ...list.map((t) => Math.max(t.base_weight * 1.5, t.effective_weight)))

  return (
    <div>
      <PageHeader
        title="Topics"
        subtitle="What the paper is chosen from"
        action={
          topics.data && (
            <span className="text-sm font-bold text-muted tabular-nums">
              {onCount} of {list.length} on
            </span>
          )
        }
      />
      <p className="mb-5 text-sm text-muted">
        Turn a topic off and it stays out of the paper. Pin one and the paper has a story from it whenever there is a
        suitable one. The rest follow what gets read.
      </p>
      {topics.error && <ErrorNote onRetry={topics.reload}>{topics.error.message}</ErrorNote>}
      {!topics.data && topics.loading && <Loading />}
      <div className="space-y-3">
        {list.map((t, i) => {
          const on = t.mode !== 'block'
          const status = statusLine(t)
          const detailsId = `topic-details-${i}`
          const isOpen = open.has(t.name)
          return (
            <Card key={t.name} label={t.name}>
              <div className="flex items-center gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cx('text-[15px] font-bold', !on && 'text-muted')}>{t.name}</span>
                  {status && <span className="text-[13px] text-muted">{status}</span>}
                </div>
                {busy === t.name && <Spinner className="text-muted" />}
                <TogglePill
                  pressed={t.mode === 'pin'}
                  disabled={!on || busy === t.name}
                  onClick={() => void setMode(t, t.mode === 'pin' ? null : 'pin')}
                  aria-label={`Pin ${t.name}`}
                  title={on ? undefined : 'Turn the topic on to pin it'}
                  className="px-3.5! disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Pin
                </TogglePill>
                <Switch
                  checked={on}
                  label={`${t.name} in the paper`}
                  disabled={busy === t.name}
                  onClick={() => void setMode(t, on ? 'block' : null)}
                />
              </div>

              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={detailsId}
                onClick={() => toggleDetails(t.name)}
                className="-mb-2.5 -ml-1 flex min-h-11 items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-muted hover:text-ink"
              >
                Details
                <ChevronDown className={cx('size-4 transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <div id={detailsId} className="mt-2.5">
                  <div className="text-sm text-muted tabular-nums">
                    Weight <span className="font-semibold text-ink">{fmtWeight(t.effective_weight)}</span>
                    <span> · base {fmtWeight(t.base_weight)}</span>
                  </div>
                  <WeightBar topic={t} scale={scale} />
                  <p className="mt-3 mb-0 text-sm text-muted">
                    {t.shown === 0
                      ? 'Not shown in the last 14 days.'
                      : `Last 14 days: shown ${t.shown}, opened ${t.opened}, engaged ${t.engaged}. Open rate ${percent(t.open_rate)}, engagement rate ${percent(t.engagement_rate)}.`}
                  </p>
                  <p className="mt-2 mb-0 text-[13px] text-muted">
                    The weight moves between half and one and a half times the base, up when the topic is read
                    properly and down when it is skipped.
                  </p>
                </div>
              )}

              {error?.name === t.name && (
                <div className="mt-3">
                  <ErrorNote>{error.message}</ErrorNote>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function WeightBar({ topic, scale }: { topic: TopicView; scale: number }) {
  const eff = Math.max(0, Math.min(1, topic.effective_weight / scale))
  const base = Math.max(0, Math.min(1, topic.base_weight / scale))
  return (
    <div className="relative mt-3 h-2.5 rounded-full bg-chip" aria-hidden="true">
      <div
        className={cx('h-full rounded-full', topic.mode === 'block' ? 'bg-line' : 'bg-accent')}
        style={{ width: `${eff * 100}%` }}
      />
      <div
        className="absolute -top-1 h-4.5 w-0.5 rounded bg-ink"
        style={{ left: `calc(${base * 100}% - 1px)` }}
        title="Base weight"
      />
    </div>
  )
}
