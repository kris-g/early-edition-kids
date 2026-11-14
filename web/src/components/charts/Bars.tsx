import { useId } from 'react'
import { cx } from '../../lib/cx'
import { dayMonthShort, money, weekdayShortDay } from '../../lib/format'
import { moneyScale } from '../../lib/stats'
import { costTip } from '../../lib/tips'
import { useRoving } from '../tooltip/useRoving'
import { useTip } from '../tooltip/useTip'

/** "N of 6 read" as six short segments. */
export function ProgressSegments({ read, total }: { read: number; total: number }) {
  return (
    <div
      role="img"
      aria-label={`${read} of ${total} stories read`}
      className="grid gap-[5px]"
      style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: Math.max(total, 1) }, (_, i) => (
        <span
          key={i}
          className={cx('box-border h-2 rounded', i < read ? 'bg-accent' : 'border border-line bg-chip')}
        />
      ))}
    </div>
  )
}

/** A thin track with a filled part, e.g. topic reads or the money limit. */
export function Meter({
  fraction,
  label,
  tone = 'accent',
  tip: withTip,
}: {
  fraction: number
  label: string
  tone?: 'accent' | 'warm' | 'danger'
  /** Show `label` as a tooltip on hover, focus and tap. */
  tip?: boolean
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100
  const id = useId()
  const tip = useTip()
  const tipProps = withTip ? tip(id, label) : { 'aria-label': label }
  return (
    <div
      role="img"
      {...tipProps}
      className={cx('flex h-2.5 overflow-hidden rounded-[5px] bg-chip', withTip && 'cursor-default')}
    >
      <span
        className={cx('rounded-[5px]', tone === 'accent' ? 'bg-accent' : tone === 'warm' ? 'bg-warm' : 'bg-danger')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Cost per day, today's bar in full warm and the rest lighter, with a money axis. */
export function CostBars({
  days,
  today,
  height = 120,
  axis = true,
}: {
  days: { date: string; cost_usd: number; calls?: number | null }[]
  today: string
  height?: number
  axis?: boolean
}) {
  const n = days.length
  const id = useId()
  const tip = useTip()
  const roving = useRoving(n)
  if (n === 0) return <p className="text-sm text-muted">No costs recorded yet this month.</p>
  const values = days.map((d) => d.cost_usd)
  const { max, step } = moneyScale(values)
  const ticks: number[] = []
  for (let t = max; t >= -1e-9; t -= step) ticks.push(Math.max(0, Math.round(t * 100) / 100))
  const mostIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0)
  const low = Math.min(...values)
  const todayCost = days.find((d) => d.date === today)?.cost_usd
  const label = `Bar chart of cost per day for ${n} days, between ${money(low)} and ${money(values[mostIdx])}.`
  const gap = n <= 14 ? 4 : 2
  return (
    <div className="flex gap-2">
      {axis && (
        <div
          aria-hidden="true"
          className="flex flex-col justify-between text-right text-[11px] text-muted"
          style={{ height }}
        >
          {ticks.map((t) => (
            <span key={t} className="leading-none">
              {t === 0 ? '$0' : `$${t.toFixed(2)}`}
            </span>
          ))}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          role="group"
          aria-label={label}
          data-roving
          className="relative grid items-end border-b border-line"
          style={{ height, gap, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {axis &&
            ticks.slice(1, -1).map((t) => (
              <span
                key={t}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-line"
                style={{ bottom: (t / max) * height }}
              />
            ))}
          {days.map((d, i) => (
            <span
              key={d.date}
              role="img"
              {...tip(`${id}-${i}`, costTip(d.date, d.cost_usd, d.calls), {
                tabIndex: roving.tabIndex(i),
                onFocus: roving.onFocus(i),
                onKeyDown: roving.onKeyDown,
              })}
              className="flex h-full cursor-default items-end rounded-t-[3px] hover:bg-chip/60 focus-visible:bg-chip/60"
            >
              <span
                className={cx('w-full rounded-t-[3px]', d.date === today ? 'bg-warm' : 'warm-65')}
                style={{ height: d.cost_usd > 0 ? Math.max(2, (d.cost_usd / max) * height) : 1 }}
              />
            </span>
          ))}
        </div>
        {axis && (
          <div className="flex justify-between gap-2 text-[11px] text-muted">
            <span className="whitespace-nowrap">{dayMonthShort(days[0].date)}</span>
            <span className="min-w-0 truncate text-center">
              Most: {money(values[mostIdx])} on {weekdayShortDay(days[mostIdx].date)}
            </span>
            <span className="text-right whitespace-nowrap">{todayCost !== undefined ? `Today ${money(todayCost)}` : ''}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export type StackPart = { key: string; label: string; value: number; color: string; tip?: string }

/** Where a day's money goes: one bar split by stage; each part has its own tooltip. */
export function StackedBar({ parts, label }: { parts: StackPart[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  const id = useId()
  const tip = useTip()
  const roving = useRoving(shown.length, 0)
  return (
    <div role="group" aria-label={label} data-roving className="flex h-4 gap-0.5 overflow-hidden rounded-lg bg-chip">
      {total > 0 &&
        shown.map((p, i) => (
          <span
            key={p.key}
            role="img"
            {...tip(`${id}-${i}`, p.tip ?? p.label, {
              tabIndex: roving.tabIndex(i),
              onFocus: roving.onFocus(i),
              onKeyDown: roving.onKeyDown,
            })}
            className="cursor-default hover:brightness-110"
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
          />
        ))}
    </div>
  )
}
