import { describe, expect, it } from 'vitest'
import { addDays, dayAndDate, londonDate, londonTime, longDate, mondayOf, stampDate, weekRange, weekday } from './clock'

describe('London dates', () => {
  it('follows British Summer Time', () => {
    // 23:30 UTC in summer is already tomorrow in London; in winter it is not.
    expect(londonDate(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02')
    expect(londonDate(new Date('2026-11-16T23:30:00Z'))).toBe('2026-11-16')
    // The clocks change at 01:00 UTC on the last Sunday of March and October.
    expect(londonTime(new Date('2026-03-29T00:59:00Z'))).toBe('00:59')
    expect(londonTime(new Date('2026-03-29T01:00:00Z'))).toBe('02:00')
    expect(londonTime(new Date('2026-10-25T00:59:00Z'))).toBe('01:59')
    expect(londonTime(new Date('2026-10-25T01:00:00Z'))).toBe('01:00')
  })

  it('does date sums and names days', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(weekday('2026-11-16')).toBe(1)
    expect(mondayOf('2026-11-22')).toBe('2026-11-16')
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    expect(longDate('2026-11-13')).toBe('Friday 13 November 2026')
    expect(dayAndDate('2026-11-13')).toBe('Friday 13 November')
    expect(stampDate('2026-11-13')).toBe('13 NOV')
    expect(weekRange('2026-11-16')).toBe('Monday 16 to Sunday 22 November')
    expect(weekRange('2026-10-26')).toBe('Monday 26 October to Sunday 1 November')
  })
})
