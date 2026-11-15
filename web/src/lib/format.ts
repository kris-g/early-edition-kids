import type { StoryStats } from '../api/types'

const TZ = 'Europe/London'

/** Today's date in Europe/London as YYYY-MM-DD (the server's idea of "today"). */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now)
}

function dateOnly(date: string): Date {
  // Noon UTC keeps a YYYY-MM-DD on the same calendar day in any timezone.
  return new Date(`${date.slice(0, 10)}T12:00:00Z`)
}

/** "Friday 13 November" (adds the year when it is not this year). */
export function longDate(date: string, now: Date = new Date()): string {
  const d = dateOnly(date)
  const sameYear = date.slice(0, 4) === londonToday(now).slice(0, 4)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d)
}

/** "Fri 13 Nov" */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dateOnly(date))
}

/** A timestamp as London time: "06:41" today, "Thu 12 Nov, 06:41" otherwise. Unparseable strings pass through. */
export function timeOf(ts: string | number, now: Date = new Date()): string {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d)
  if (londonToday(d) === londonToday(now)) return time
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
  return `${day}, ${time}`
}

/** "05:30" in London time, whatever the day. */
export function clockTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d)
}

/** 110 -> "1 min 50 s", 40 -> "40 s", 120 -> "2 min". */
export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r} s`
  if (r === 0) return `${m} min`
  return `${m} min ${String(r).padStart(2, "0")} s`
}

export function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export type ReadState = 'not_opened' | 'opened' | 'finished' | 'engaged'

export function readState(stats: StoryStats): ReadState {
  if (stats.engaged) return 'engaged'
  if (stats.reached_end) return 'finished'
  if (stats.opened) return 'opened'
  return 'not_opened'
}

export const READ_STATE_LABEL: Record<ReadState, string> = {
  not_opened: 'Not opened',
  opened: 'Opened',
  finished: 'Finished',
  engaged: 'Engaged',
}

export const ENGAGED_EXPLAINER =
  'Engaged means the story was opened, read to the last page and given at least half the expected reading time.'

/** "Opened, read to the end, 1 min 50 s of an expected 1 min 30 s" */
export function statsSentence(stats: StoryStats): string {
  if (!stats.opened) return `Not opened yet. Expected reading time ${duration(stats.expected_seconds)}.`
  const end = stats.reached_end ? 'read to the end' : 'not read to the end'
  return `Opened, ${end}, ${duration(stats.active_seconds)} of an expected ${duration(stats.expected_seconds)}`
}

/** "bbc.co.uk" from a URL, or the input when it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function looksLikeUrl(text: string): boolean {
  const t = text.trim()
  if (!/^https?:\/\/\S+$/i.test(t)) return false
  try {
    const u = new URL(t)
    return Boolean(u.hostname.includes('.'))
  } catch {
    return false
  }
}

// --- dates (YYYY-MM-DD strings, Europe/London calendar) ----------------------

export function addDaysIso(date: string, n: number): string {
  const d = dateOnly(date)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(date: string): number {
  return (dateOnly(date).getUTCDay() + 6) % 7
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts })

/** "13 Nov" */
export function dayMonthShort(date: string): string {
  return fmt({ day: 'numeric', month: 'short' }).format(dateOnly(date))
}

/** "13 November" */
export function dayMonthLong(date: string): string {
  return fmt({ day: 'numeric', month: 'long' }).format(dateOnly(date))
}

/** "Friday 13 November" (no year) */
export function weekdayDayMonth(date: string): string {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(dateOnly(date))
}

/** "Sun 15 Nov" */
export function weekdayDayMonthShort(date: string): string {
  return fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(dateOnly(date))
}

/** "Fri 13" */
export function weekdayShortDay(date: string): string {
  return fmt({ weekday: 'short', day: 'numeric' }).format(dateOnly(date))
}

/** "Mon" */
export function weekdayShort(date: string): string {
  return fmt({ weekday: 'short' }).format(dateOnly(date))
}

/** "M" */
export function weekdayLetter(date: string): string {
  return weekdayShort(date).charAt(0)
}

/** "2026-11" -> "November 2026" */
export function monthTitle(month: string): string {
  return fmt({ month: 'long', year: 'numeric' }).format(dateOnly(`${month}-01`))
}

/** "2026-11" -> "November" */
export function monthName(month: string): string {
  return fmt({ month: 'long' }).format(dateOnly(`${month}-01`))
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** "31 October to 13 November" */
export function rangeLabel(from: string, to: string): string {
  return `${dayMonthLong(from)} to ${dayMonthLong(to)}`
}

// --- money and numbers ------------------------------------------------------

export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  if (usd >= 100) return `$${Math.round(usd)}`
  return `$${usd.toFixed(2)}`
}

/** "$25" for whole dollars, else "$12.50". */
export function moneyShort(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`
}

export function thousands(n: number): string {
  return new Intl.NumberFormat('en-GB').format(Math.round(n))
}

/** 4.25 -> "4.3", 4 -> "4" */
export function oneDecimal(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * "anthropic:claude-opus-5-5" -> "Claude Opus 5.5", "openrouter:moonshotai/kimi-k3.1-pro" -> "Kimi K3.1 Pro".
 * A fallback for when no ModelOption name is known.
 */
export function prettyModel(id: string): string {
  const bare = id.replace(/^[a-z]+:/, '')
  const parts = bare.slice(bare.lastIndexOf('/') + 1).split(/[-_]/)
  const words: string[] = []
  const nums: string[] = []
  for (const p of parts) {
    if (/^\d+$/.test(p)) nums.push(p)
    else {
      if (nums.length) {
        words.push(nums.join('.'))
        nums.length = 0
      }
      words.push(p.charAt(0).toUpperCase() + p.slice(1))
    }
  }
  if (nums.length) words.push(nums.join('.'))
  return words.join(' ')
}

/** "Read to the end · 1 min 50 s" and friends, for the story status pills. */
export type StoryStatusKind = 'read' | 'opened' | 'none'

/** With `paperDate`, a story read on a later day says when: "Read on Sun 15 Nov · 3 min 27 s". */
export function storyStatus(
  stats: StoryStats,
  short = false,
  paperDate?: string,
): { kind: StoryStatusKind; label: string } {
  if (stats.reached_end) {
    const later = paperDate && stats.read_on && stats.read_on !== paperDate
    const what = later ? `Read on ${weekdayDayMonthShort(stats.read_on!)}` : short ? 'Read' : 'Read to the end'
    return { kind: 'read', label: `${what} · ${duration(stats.active_seconds)}` }
  }
  if (stats.opened) return { kind: 'opened', label: `Opened · ${duration(stats.active_seconds)}` }
  return { kind: 'none', label: 'Not opened yet' }
}

/** "read · 4 minutes so far" under the paper's read count. */
export function minutesLine(minutes: number | undefined): string {
  if (!minutes) return 'read'
  const m = Math.round(minutes)
  return m < 1 ? `read · ${oneDecimal(minutes)} minutes so far` : `read · ${plural(m, 'minute')} so far`
}
