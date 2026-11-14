import { useId } from 'react'
import type { ReadingDay, Streak } from '../../api/types'
import { cx } from '../../lib/cx'
import { dayMonthShort, londonToday, plural, weekdayShortDay } from '../../lib/format'
import { stripKind } from '../../lib/stats'
import { dayTip } from '../../lib/tips'
import { useRoving } from '../tooltip/useRoving'
import { useTip } from '../tooltip/useTip'

/** One cell per day: missed days outlined, the current streak strong, other reading days lighter. */
export function DayStrip({ days, streak, tall }: { days: ReadingDay[]; streak: Streak; tall?: boolean }) {
  const n = days.length
  const cols = n <= 14 ? n : n <= 31 ? Math.ceil(n / 2) : 14
  const readDays = days.filter((d) => d.read > 0).length
  const missed = days.filter((d) => d.read <= 0)
  const missedText =
    missed.length === 0
      ? 'no days missed'
      : missed.length <= 3
        ? `missed ${missed.map((d) => weekdayShortDay(d.date)).join(', ')}`
        : `${plural(missed.length, 'day')} without reading`
  const label = `He read on ${readDays} of the last ${n} days; ${missedText}.`
  const id = useId()
  const tip = useTip()
  const roving = useRoving(n)
  const today = londonToday()
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={label}
        data-roving
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {days.map((d, i) => {
          const kind = stripKind(d, streak)
          return (
            <span
              key={d.date}
              role="img"
              {...tip(`${id}-${i}`, dayTip(d, today), {
                tabIndex: roving.tabIndex(i),
                onFocus: roving.onFocus(i),
                onKeyDown: roving.onKeyDown,
              })}
              className={cx(
                'cursor-default',
                'box-border rounded-[5px]',
                tall ? 'h-[22px]' : n > 31 ? 'h-3.5' : 'h-5',
                kind === 'missed' && 'border-2 border-line',
                kind === 'streak' && 'bg-accent',
                kind === 'read' && 'shade-2',
              )}
            />
          )
        })}
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-muted">
        <span>{dayMonthShort(days[0].date)}</span>
        {missed.length > 0 && missed.length <= 2 && (
          <span>Missed: {missed.map((d) => weekdayShortDay(d.date)).join(', ')}</span>
        )}
        <span>Today</span>
      </div>
    </div>
  )
}
