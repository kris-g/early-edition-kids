// Tooltip text for chart marks: the date in short form plus the values in plain words.
// The same text is the mark's aria-label, so screen readers get it too.
import type { ReadingDay } from '../api/types'
import { money, oneDecimal, plural, shortDate } from './format'

export type TipDay = Pick<ReadingDay, 'date' | 'issue' | 'stories' | 'read' | 'minutes'> & { allRead?: boolean }

function minutesText(minutes: number): string | null {
  if (!minutes || minutes <= 0) return null
  // One decimal, like the chart's own labels ("11.9 min"); whole numbers stay whole ("9 min").
  return `${oneDecimal(minutes)} min reading`
}

/** "Tue 10 Nov · 5 stories read · 9 min reading", "… · Not read", "… · No paper", "… · Not yet". */
export function dayTip(day: TipDay, today: string): string {
  const date = shortDate(day.date)
  if (day.date > today) return `${date} · Not yet`
  const mins = minutesText(day.minutes)
  if (!day.issue) {
    return day.read > 0
      ? [date, 'No paper', `${plural(day.read, 'story', 'stories')} read`, mins].filter(Boolean).join(' · ')
      : `${date} · No paper`
  }
  // The count is what he read that day, from any paper, so it can be more than the day's own paper.
  const paper = day.allRead ? 'Paper all read' : null
  if (day.read <= 0) return [date, 'Not read', paper].filter(Boolean).join(' · ')
  return [date, `${plural(day.read, 'story', 'stories')} read`, mins, paper].filter(Boolean).join(' · ')
}

/** "Tue 10 Nov · $0.36 · 15 calls" (calls only when known). */
export function costTip(date: string, cost: number, calls?: number | null): string {
  const parts = [shortDate(date), money(cost)]
  if (calls !== undefined && calls !== null) parts.push(plural(calls, 'call'))
  return parts.join(' · ')
}

/** "Writing · 7 calls · $0.30 (65%)" */
export function stageTip(label: string, calls: number, cost: number, total: number): string {
  const pct = total > 0 ? Math.round((cost / total) * 100) : 0
  return `${label} · ${plural(calls, 'call')} · ${money(cost)} (${pct}%)`
}

/** "Football · 10 of 13 read (77%)" */
export function topicTip(name: string, read: number, shown: number): string {
  if (shown <= 0) return `${name} · none shown`
  return `${name} · ${read} of ${shown} read (${Math.round((read / shown) * 100)}%)`
}
