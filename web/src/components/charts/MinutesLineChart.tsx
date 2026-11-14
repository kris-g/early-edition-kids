import { useId, useState } from 'react'
import type { ReadingDay } from '../../api/types'
import { dayMonthShort, londonToday, oneDecimal, weekdayShortDay } from '../../lib/format'
import { dayTip } from '../../lib/tips'
import { useRoving } from '../tooltip/useRoving'
import { useTip } from '../tooltip/useTip'

const W = 322
const H = 96
const PAD = 10

/**
 * Minutes spent reading each day, as a filled line. Invisible columns over the
 * chart pick the nearest day to the pointer (or keyboard focus) and show a
 * marker and the tooltip for it.
 */
export function MinutesLineChart({ days }: { days: ReadingDay[] }) {
  const n = days.length
  const top = Math.max(1, ...days.map((d) => d.minutes))
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (m: number) => H - PAD - (m / top) * (H - PAD * 2)
  const pts = days.map((d, i) => `${x(i).toFixed(1)} ${y(d.minutes).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  const area = `M0 ${H - PAD} L${pts.join(' L')} L${W} ${H - PAD} Z`
  const mostIdx = days.reduce((best, d, i) => (d.minutes > days[best].minutes ? i : best), 0)
  const last = days[n - 1]
  const first = days[0]
  const low = Math.min(...days.map((d) => d.minutes))
  const label = `Line chart of minutes spent reading each day, between ${oneDecimal(low)} and ${oneDecimal(top)} minutes.`
  const id = useId()
  const tip = useTip()
  const roving = useRoving(n)
  const today = londonToday()
  const [active, setActive] = useState<number | null>(null)
  const pct = (i: number) => `${(x(i) / W) * 100}%`
  // Each day's hover zone runs halfway to its neighbours, so the pointer picks the nearest day.
  const zone = (i: number) => {
    const left = i === 0 ? 0 : (x(i - 1) + x(i)) / 2
    const right = i === n - 1 ? W : (x(i) + x(i + 1)) / 2
    return { left: `${(left / W) * 100}%`, width: `${((right - left) / W) * 100}%` }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative text-accent" role="group" aria-label={label} data-roving>
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="block overflow-visible"
        >
          <path d={area} fill="currentColor" fillOpacity={0.16} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* The end dot and the hover marker are HTML so they stay round when the SVG stretches. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: pct(n - 1), top: y(last.minutes) }}
        />
        {active !== null && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 w-0 -translate-x-1/2 border-l border-dashed border-muted"
              style={{ left: pct(active) }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-accent"
              style={{ left: pct(active), top: y(days[active].minutes) }}
            />
          </>
        )}
        <div className="absolute inset-0">
          {days.map((d, i) => (
            <span
              key={d.date}
              role="img"
              {...tip(`${id}-${i}`, dayTip(d, today), {
                tabIndex: roving.tabIndex(i),
                onFocus: roving.onFocus(i),
                onKeyDown: roving.onKeyDown,
                onShow: () => setActive(i),
                onHide: () => setActive((a) => (a === i ? null : a)),
              })}
              className="absolute top-0 h-full cursor-default"
              style={zone(i)}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-muted">
        <span className="whitespace-nowrap">
          {dayMonthShort(first.date)} · {oneDecimal(first.minutes)} min
        </span>
        <span className="min-w-0 truncate text-center">
          Most: {oneDecimal(days[mostIdx].minutes)} min on {weekdayShortDay(days[mostIdx].date)}
        </span>
        <span className="text-right whitespace-nowrap">Today · {oneDecimal(last.minutes)} min</span>
      </div>
    </div>
  )
}
