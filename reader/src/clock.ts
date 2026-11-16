// Europe/London dates, worked out from the UK summer-time rule as the Kindle plugin does
// (plugin/.../clock.lua): BST runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the
// last Sunday of October. Dates are ISO strings ("2026-11-13"), which sort as plain strings.

const DAY = 86_400

function daysFromCivil(y: number, m: number, d: number): number {
  if (m <= 2) y -= 1
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (m + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function civilFromDays(z: number): [number, number, number] {
  z += 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
}

const weekdayOfDays = (days: number) => (((days + 4) % 7) + 7) % 7 // 0 = Sunday

function lastSunday(y: number, m: number): number {
  const last = m === 12 ? daysFromCivil(y + 1, 1, 1) - 1 : daysFromCivil(y, m + 1, 1) - 1
  return last - weekdayOfDays(last)
}

/** Seconds London is ahead of UTC at an epoch (0 or 3600). */
export function londonOffset(epochSeconds: number): number {
  const [y] = civilFromDays(Math.floor(epochSeconds / DAY))
  const start = lastSunday(y, 3) * DAY + 3600
  const end = lastSunday(y, 10) * DAY + 3600
  return epochSeconds >= start && epochSeconds < end ? 3600 : 0
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** The London date at a moment. */
export function londonDate(at: Date = new Date()): string {
  const secs = Math.floor(at.getTime() / 1000)
  return iso(...civilFromDays(Math.floor((secs + londonOffset(secs)) / DAY)))
}

/** "07:12", London time. */
export function londonTime(at: Date = new Date()): string {
  const secs = Math.floor(at.getTime() / 1000)
  const local = (((secs + londonOffset(secs)) % DAY) + DAY) % DAY
  return `${pad(Math.floor(local / 3600))}:${pad(Math.floor((local % 3600) / 60))}`
}

export function parseIso(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [y, mo, d] : null
}

export const isIsoDate = (s: unknown): s is string => typeof s === 'string' && parseIso(s) !== null

const toDays = (s: string) => {
  const p = parseIso(s)
  return p ? daysFromCivil(...p) : NaN
}

export function addDays(s: string, n: number): string {
  return iso(...civilFromDays(toDays(s) + n))
}

/** Whole days from a to b. */
export const daysBetween = (a: string, b: string) => toDays(b) - toDays(a)

/** 0 = Sunday ... 6 = Saturday. */
export const weekday = (s: string) => weekdayOfDays(toDays(s))

/** The Monday of the week (Monday to Sunday) holding a date. */
export const mondayOf = (s: string) => addDays(s, -((weekday(s) + 6) % 7))

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "Friday 13 November 2026" (the dateline). */
export function longDate(s: string): string {
  const p = parseIso(s)
  if (!p) return s
  return `${WEEKDAYS[weekday(s)]} ${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}`
}

/** "Friday 13 November" (Back issues). */
export function dayAndDate(s: string): string {
  const p = parseIso(s)
  if (!p) return s
  return `${WEEKDAYS[weekday(s)]} ${p[2]} ${MONTHS[p[1] - 1]}`
}

/** "13 NOV" (the Read stamp). */
export function stampDate(s: string): string {
  const p = parseIso(s)
  if (!p) return ''
  return `${p[2]} ${MONTHS[p[1] - 1].slice(0, 3).toUpperCase()}`
}

/** "Monday 9 to Sunday 15 November", or across two months "Monday 27 October to Sunday 2 November". */
export function weekRange(monday: string): string {
  const sunday = addDays(monday, 6)
  const a = parseIso(monday)
  const b = parseIso(sunday)
  if (!a || !b) return ''
  return a[1] === b[1]
    ? `Monday ${a[2]} to Sunday ${b[2]} ${MONTHS[b[1] - 1]}`
    : `Monday ${a[2]} ${MONTHS[a[1] - 1]} to Sunday ${b[2]} ${MONTHS[b[1] - 1]}`
}

/** Epoch seconds now. */
export const nowSeconds = () => Math.floor(Date.now() / 1000)
