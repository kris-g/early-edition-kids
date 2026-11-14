import { describe, expect, it } from 'vitest'
import type { CalendarView } from '../api/types'
import { calendarCells, cellClass, countScale, moneyScale, shadeFor, stripKind, thisWeek } from './stats'

function november(today: string): CalendarView {
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = `2026-11-${String(i + 1).padStart(2, '0')}`
    const read = date <= today ? (i % 7) : 0
    return { date, issue: date <= today, stories: 6, read, minutes: read * 2, all_read: read >= 6 }
  })
  return { month: '2026-11', days, total_read: 0, reading_days: 0, all_read_days: 0, elapsed_days: 13 }
}

describe('calendar shading', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [6, 3],
    [7, 3],
  ])('%i stories read -> shade %i', (read, shade) => {
    expect(shadeFor(read)).toBe(shade)
  })

  it('lays out Monday-first weeks with the neighbouring months greyed', () => {
    const cells = calendarCells(november('2026-11-13'), '2026-11-13')
    // 1 November 2026 is a Sunday, so the grid starts on Monday 26 October.
    expect(cells[0].date).toBe('2026-10-26')
    expect(cells[0].inMonth).toBe(false)
    expect(cells[6].date).toBe('2026-11-01')
    expect(cells.length % 7).toBe(0)
    expect(cells[cells.length - 1].date).toBe('2026-12-06')
  })

  it('marks future days, ignores any reads on them, and draws them dashed', () => {
    const view = november('2026-11-13')
    view.days[20].read = 5 // should never happen, but must not shade a future day
    const cells = calendarCells(view, '2026-11-13')
    const future = cells.find((c) => c.date === '2026-11-21')!
    expect(future.future).toBe(true)
    expect(future.read).toBe(0)
    expect(future.shade).toBe(0)
    expect(cellClass(future)).toContain('border-dashed')
    const today = cells.find((c) => c.date === '2026-11-13')!
    expect(today.isToday).toBe(true)
    expect(today.future).toBe(false)
  })

  it('uses the right class for each step', () => {
    const cells = calendarCells(november('2026-11-30'), '2026-11-30')
    const byRead = (n: number) => cells.find((c) => c.inMonth && c.read === n)!
    expect(cellClass(byRead(0))).toContain('border-line')
    expect(cellClass(byRead(2))).toContain('shade-1')
    expect(cellClass(byRead(4))).toContain('shade-2')
    expect(cellClass(byRead(6))).toContain('bg-accent')
  })
})

describe('week and strip', () => {
  it('builds this week Monday to Sunday with future days empty', () => {
    const days = [
      { date: '2026-11-09', issue: true, stories: 6, read: 0, minutes: 0 },
      { date: '2026-11-10', issue: true, stories: 6, read: 5, minutes: 9 },
      { date: '2026-11-13', issue: true, stories: 6, read: 2, minutes: 4 },
    ]
    const week = thisWeek(days, '2026-11-13')
    expect(week.map((d) => d.name)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(week.map((d) => d.read)).toEqual([0, 5, 0, 0, 2, null, null])
    expect(week[4].isToday).toBe(true)
    expect(week[5].future).toBe(true)
  })

  it('strip: missed, in the current streak, or an earlier reading day', () => {
    const streak = { current: 2, current_since: '2026-11-12', longest: 5, longest_from: null, longest_to: null }
    expect(stripKind({ date: '2026-11-13', issue: true, stories: 6, read: 1, minutes: 1 }, streak)).toBe('streak')
    expect(stripKind({ date: '2026-11-10', issue: true, stories: 6, read: 3, minutes: 1 }, streak)).toBe('read')
    expect(stripKind({ date: '2026-11-11', issue: true, stories: 6, read: 0, minutes: 0 }, streak)).toBe('missed')
  })

  it('scales', () => {
    expect(countScale([1, 2])).toBe(6)
    expect(countScale([9])).toBe(9)
    expect(moneyScale([0.41, 0.58])).toEqual({ max: 0.6, step: 0.2 })
    expect(moneyScale([2.3]).max).toBe(2.5)
  })
})
