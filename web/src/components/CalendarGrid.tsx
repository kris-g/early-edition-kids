import { useId } from 'react'
import type { CalendarView } from '../api/types'
import { cx } from '../lib/cx'
import { calendarCells, cellClass, type CalendarCell } from '../lib/stats'
import { dayTip } from '../lib/tips'
import { useRoving } from './tooltip/useRoving'
import { useTip } from './tooltip/useTip'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function cellText(c: CalendarCell, today: string): string {
  return dayTip({ date: c.date, issue: c.issue, stories: c.stories, read: c.read, minutes: c.minutes }, today)
}

/** Month grid, Monday first. Interactive (buttons) on the Calendar page, plain on the overview. */
export function CalendarGrid({
  view,
  today,
  selected,
  onSelect,
  compact,
}: {
  view: CalendarView
  today: string
  selected?: string | null
  onSelect?: (date: string) => void
  compact?: boolean
}) {
  const cells = calendarCells(view, today)
  const id = useId()
  const tip = useTip()
  const monthCells = cells.filter((c) => c.inMonth)
  const roving = useRoving(monthCells.length, monthCells.findIndex((c) => c.isToday))
  const height = compact ? 'h-[42px] rounded-lg' : 'h-[52px] rounded-[10px]'
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-7 gap-[5px] text-center text-[11px] font-bold text-muted">
        {DAY_NAMES.map((d) => (
          <span key={d} aria-hidden={compact || undefined}>
            {compact ? d.charAt(0) : d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[5px]" data-roving role={compact ? 'group' : undefined} aria-label={compact ? 'Stories read each day this month' : undefined}>
        {cells.map((c) => {
          const inner = (
            <>
              <span className={cx('font-semibold', compact ? 'text-xs' : 'text-[13px]')}>{c.day}</span>
              <span className="min-h-[13px] text-[11px] font-bold">{c.inMonth && !c.future ? c.read : ''}</span>
            </>
          )
          const cls = cx(
            'box-border flex flex-col items-center justify-center gap-px p-0',
            height,
            cellClass(c),
            c.isToday && 'outline-2 outline-offset-2 outline-ink',
            selected === c.date && 'shadow-[0_0_0_3px_var(--warm)]',
          )
          if (!c.inMonth) {
            return (
              <span key={c.date} className={cls} aria-hidden="true">
                {inner}
              </span>
            )
          }
          const m = monthCells.indexOf(c)
          const tipProps = tip(`${id}-${m}`, cellText(c, today), {
            tabIndex: compact ? roving.tabIndex(m) : undefined,
            onFocus: compact ? roving.onFocus(m) : undefined,
            onKeyDown: compact ? roving.onKeyDown : undefined,
          })
          if (!onSelect) {
            return (
              <span key={c.date} role="img" {...tipProps} className={cx(cls, 'cursor-default')}>
                {inner}
              </span>
            )
          }
          // Future days stay focusable (aria-disabled) so their "Not yet" tooltip can be reached.
          return (
            <button
              key={c.date}
              type="button"
              {...tipProps}
              aria-disabled={c.future || undefined}
              aria-pressed={c.future ? undefined : selected === c.date}
              onClick={() => {
                if (!c.future) onSelect(c.date)
              }}
              className={cx(cls, c.future ? 'cursor-default' : 'cursor-pointer')}
            >
              {inner}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function CalendarLegend() {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-2.5 pt-1 text-xs text-muted">
      <span>Stories read:</span>
      <span className="flex items-center gap-[5px]">
        <span className="box-border size-3.5 rounded border border-line" />0
      </span>
      <span className="flex items-center gap-[5px]">
        <span className="shade-1 size-3.5 rounded" />1 to 2
      </span>
      <span className="flex items-center gap-[5px]">
        <span className="shade-2 size-3.5 rounded" />3 to 4
      </span>
      <span className="flex items-center gap-[5px]">
        <span className="size-3.5 rounded bg-accent" />5 to 6
      </span>
    </div>
  )
}
