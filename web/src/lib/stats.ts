// Pure helpers behind the reading, calendar and streak views.
import type { CalendarView, ReadingDay, Streak } from '../api/types'
import { addDaysIso, weekdayIndex, weekdayShort } from './format'

/** Calendar and strip shading: 0 read (outlined), 1 to 2, 3 to 4, 5 or more. */
export type Shade = 0 | 1 | 2 | 3

export function shadeFor(read: number): Shade {
  if (read <= 0) return 0
  if (read <= 2) return 1
  if (read <= 4) return 2
  return 3
}

export type CalendarCell = {
  date: string
  day: number
  inMonth: boolean
  future: boolean
  isToday: boolean
  read: number
  stories: number
  minutes: number
  issue: boolean
  allRead: boolean
  shade: Shade
}

/** Monday-first weeks covering the month, padded with the neighbouring months' dates. */
export function calendarCells(view: CalendarView, today: string): CalendarCell[] {
  const first = `${view.month}-01`
  const byDate = new Map(view.days.map((d) => [d.date, d]))
  const start = addDaysIso(first, -weekdayIndex(first))
  const lastDay = view.days.length ? view.days[view.days.length - 1].date : first
  const end = addDaysIso(lastDay, 6 - weekdayIndex(lastDay))
  const cells: CalendarCell[] = []
  for (let d = start; d <= end; d = addDaysIso(d, 1)) {
    const inMonth = d.startsWith(view.month)
    const info = byDate.get(d)
    const future = d > today
    const read = inMonth && !future ? (info?.read ?? 0) : 0
    cells.push({
      date: d,
      day: Number(d.slice(8)),
      inMonth,
      future,
      isToday: d === today,
      read,
      stories: info?.stories ?? 0,
      minutes: inMonth && !future ? (info?.minutes ?? 0) : 0,
      issue: inMonth && !future ? (info?.issue ?? false) : false,
      allRead: info?.all_read ?? false,
      shade: shadeFor(read),
    })
  }
  return cells
}

export type WeekDay = {
  date: string
  name: string
  read: number | null
  future: boolean
  isToday: boolean
  /** The reading day itself (zeros when the range has no entry for it). */
  day: ReadingDay
}

/** Monday to Sunday of the week containing `today`, with reads from `days` (null for future days). */
export function thisWeek(days: ReadingDay[], today: string): WeekDay[] {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const monday = addDaysIso(today, -weekdayIndex(today))
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(monday, i)
    const future = date > today
    const day = byDate.get(date) ?? { date, issue: false, stories: 0, read: 0, minutes: 0 }
    return {
      date,
      name: weekdayShort(date),
      read: future ? null : day.read,
      future,
      isToday: date === today,
      day,
    }
  })
}

export type StripKind = 'missed' | 'streak' | 'read'

/** Day strip: missed days outlined, days in the current streak strong, other reading days lighter. */
export function stripKind(day: ReadingDay, streak: Streak): StripKind {
  if (day.read <= 0) return 'missed'
  if (streak.current > 0 && streak.current_since && day.date >= streak.current_since) return 'streak'
  return 'read'
}

/** A round axis top for a bar chart of counts. */
export function countScale(values: number[], floor = 6): number {
  return Math.max(floor, ...values)
}

/** A round axis top for money: steps of 0.2 below $1, of 0.5 below $5, then whole dollars. */
export function moneyScale(values: number[]): { max: number; step: number } {
  const top = Math.max(0, ...values)
  if (top <= 0) return { max: 0.6, step: 0.2 }
  const step = top <= 1 ? 0.2 : top <= 5 ? 0.5 : top <= 20 ? 2 : 10
  const max = Math.max(step * 3, Math.ceil(top / step - 1e-9) * step)
  return { max: Math.round(max * 100) / 100, step }
}

/** Classes for a calendar cell: outlined (0), two lighter shades, full accent; future dashed. */
export function cellClass(c: CalendarCell): string {
  if (!c.inMonth) return 'border border-transparent text-muted opacity-55'
  if (c.future) return 'border border-dashed border-line text-muted'
  if (c.shade === 0) return 'border border-line text-ink'
  if (c.shade === 1) return 'shade-1 border border-transparent text-ink'
  if (c.shade === 2) return 'shade-2 border border-transparent text-ink'
  return 'border border-transparent bg-accent text-on-accent'
}
