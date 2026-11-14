import { useId } from 'react'
import type { ReadingDay } from '../../api/types'
import { dayMonthShort, londonToday, oneDecimal, weekdayLetter } from '../../lib/format'
import { countScale } from '../../lib/stats'
import { dayTip } from '../../lib/tips'
import { useRoving } from '../tooltip/useRoving'
import { useTip } from '../tooltip/useTip'

/**
 * Stories read each day, with a dashed line at the average. Values sit above
 * the bars and letters below when there is room (up to 14 days); longer ranges
 * get three date ticks instead.
 */
export function StoriesBarChart({
  days,
  average,
  height = 150,
  labels = 'weekday',
}: {
  days: ReadingDay[]
  average: number
  height?: number
  labels?: 'weekday' | 'date'
}) {
  const n = days.length
  const roomy = n <= 14
  const scale = countScale(days.map((d) => d.read))
  const valueSpace = roomy ? 16 : 0
  const barArea = height - valueSpace
  const gap = n <= 14 ? (height > 160 ? 10 : 5) : n <= 31 ? 3 : 1
  const most = Math.max(0, ...days.map((d) => d.read))
  const label = `Bar chart of stories read each day over ${n} days, from 0 to ${most}, averaging ${oneDecimal(average)} a day.`
  const avgBottom = (average / scale) * barArea
  const id = useId()
  const tip = useTip()
  const roving = useRoving(n)
  const today = londonToday()
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label={label}
        data-roving
        className="relative grid items-end border-b border-line"
        style={{ height, gap, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {days.map((d, i) => (
          <div
            key={d.date}
            role="img"
            {...tip(`${id}-${i}`, dayTip(d, today), {
              tabIndex: roving.tabIndex(i),
              onFocus: roving.onFocus(i),
              onKeyDown: roving.onKeyDown,
            })}
            className="flex h-full cursor-default flex-col items-center justify-end gap-[3px] rounded-t outline-offset-1 hover:bg-chip/60 focus-visible:bg-chip/60"
          >
            {roomy && (
              <span aria-hidden="true" className="text-[11px] font-semibold text-muted desk:text-xs">
                {d.read}
              </span>
            )}
            <span
              className={d.read > 0 ? 'w-full rounded-t bg-accent' : 'w-full rounded-t bg-line'}
              style={{ height: d.read > 0 ? Math.max(3, (d.read / scale) * barArea) : 2 }}
            />
          </div>
        ))}
        {average > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-warm"
            style={{ bottom: avgBottom }}
          />
        )}
      </div>
      {roomy ? (
        <div className="grid" style={{ gap, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {days.map((d) => (
            <span key={d.date} className="text-center text-[11px] text-muted desk:text-xs">
              {labels === 'date' ? Number(d.date.slice(8)) : weekdayLetter(d.date)}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex justify-between text-[11px] text-muted">
          <span>{dayMonthShort(days[0].date)}</span>
          <span>{dayMonthShort(days[Math.floor(n / 2)].date)}</span>
          <span>Today</span>
        </div>
      )}
    </div>
  )
}

export function ChartLegend({ average, extra }: { average: number; extra?: string }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted desk:text-[13px]">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-[3px] bg-accent" />
        Stories read
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dashed border-warm" />
        Average {oneDecimal(average)} a day
      </span>
      {extra && <span>{extra}</span>}
    </div>
  )
}
