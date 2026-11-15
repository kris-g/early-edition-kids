import { useState } from 'react'
import { messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { TopicMode } from '../api/routes'
import type { TopicView } from '../api/types'
import { Badge, Card, ErrorNote, Loading, PageHeader, Spinner } from '../components/ui'
import { cx } from '../lib/cx'
import { percent } from '../lib/format'
import { useApi } from '../lib/useApi'

const MODES: { mode: TopicMode; label: string }[] = [
  { mode: null, label: 'None' },
  { mode: 'pin', label: 'Pin' },
  { mode: 'block', label: 'Block' },
]

function fmtWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : w.toFixed(1)
}

export function Topics() {
  const topics = useApi('topics', (signal) => api.topics(signal))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ name: string; message: string } | null>(null)

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

  const list = topics.data ?? []
  const scale = Math.max(1, ...list.map((t) => Math.max(t.base_weight * 1.5, t.effective_weight)))

  return (
    <div>
      <PageHeader title="Topics" subtitle="What tomorrow’s picks lean towards" />
      <p className="mb-5 text-sm text-muted">
        Each topic starts from its base weight. Over the last 14 days, topics that are read properly move up and ones
        that are skipped move down, between half and one and a half times the base. Pin or block a topic to override
        that.
      </p>
      {topics.error && <ErrorNote onRetry={topics.reload}>{topics.error.message}</ErrorNote>}
      {!topics.data && topics.loading && <Loading />}
      <div className="space-y-3">
        {list.map((t) => (
          <Card key={t.name}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold">{t.name}</span>
                {t.mode === 'pin' && <Badge tone="green">Pinned</Badge>}
                {t.mode === 'block' && <Badge tone="rose">Blocked</Badge>}
              </div>
              <div className="text-sm text-muted tabular-nums dark:text-muted">
                Weight <span className="font-semibold text-ink">{fmtWeight(t.effective_weight)}</span>
                <span> · base {fmtWeight(t.base_weight)}</span>
              </div>
            </div>

            <WeightBar topic={t} scale={scale} />

            <p className="mt-3 text-sm text-muted">
              {t.shown === 0 ? (
                'Not shown in the last 14 days.'
              ) : (
                <>
                  Last 14 days: shown {t.shown}, opened {t.opened}, engaged {t.engaged}.
                  <span className="text-muted">
                    {' '}
                    Open rate {percent(t.open_rate)}, engagement rate {percent(t.engagement_rate)}.
                  </span>
                </>
              )}
            </p>

            <div className="mt-3 flex items-center gap-3">
              <div
                role="radiogroup"
                aria-label={`${t.name}: none, pin or block`}
                className="grid flex-1 grid-cols-3 gap-1.5 sm:max-w-sm"
              >
                {MODES.map(({ mode, label }) => {
                  const on = t.mode === mode
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={busy === t.name}
                      onClick={() => void setMode(t, mode)}
                      className={cx(
                        'min-h-11 rounded-[10px] border text-[13px] font-bold transition disabled:opacity-60',
                        on ? 'border-ink bg-ink text-bg' : 'border-line text-ink hover:bg-chip',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {busy === t.name && <Spinner className="text-muted" />}
            </div>
            {error?.name === t.name && (
              <div className="mt-3">
                <ErrorNote>{error.message}</ErrorNote>
              </div>
            )}
          </Card>
        ))}
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
        className={cx(
          'h-full rounded-full',
          topic.mode === 'block' ? 'bg-line' : 'bg-accent',
        )}
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
