// Dashboard v2 views for the mock: reading, streaks and the calendar.
import type { CalendarView, ReadingDay, ReadingView, ShareView, Streak } from '../src/api/types.ts'
import { TOPICS, addDays, db, issueStories, londonToday } from './data.ts'

function dayOf(date: string, today: string): ReadingDay {
  const rec = db.issues.get(date)
  if (!rec || date > today) return { date, issue: false, stories: 0, read: 0, minutes: 0 }
  const stories = issueStories(rec)
  const visible = stories.filter((s) => !s.hidden)
  const read = stories.filter((s) => s.stats.reached_end).length
  const seconds = stories.reduce((a, s) => a + (s.stats.opened ? s.stats.active_seconds : 0), 0)
  return { date, issue: true, stories: visible.length, read, minutes: Math.round((seconds / 60) * 10) / 10 }
}

export function streak(): Streak {
  const today = londonToday()
  const readOn = (d: string) => dayOf(d, today).read > 0
  const end = readOn(today) ? today : addDays(today, -1)
  let current = 0
  let since: string | null = null
  for (let d = end; readOn(d); d = addDays(d, -1)) {
    current++
    since = d
  }
  // Longest run over the whole history.
  const dates = [...db.issues.keys()].sort()
  let best = 0
  let bestFrom: string | null = null
  let bestTo: string | null = null
  let run = 0
  let runFrom: string | null = null
  let prev: string | null = null
  for (const d of dates) {
    if (!readOn(d)) {
      run = 0
      prev = d
      continue
    }
    if (run > 0 && prev && addDays(prev, 1) === d) run++
    else {
      run = 1
      runFrom = d
    }
    if (run > best) {
      best = run
      bestFrom = runFrom
      bestTo = d
    }
    prev = d
  }
  return { current, current_since: since, longest: best, longest_from: bestFrom, longest_to: bestTo }
}

export function readingView(days: number): ReadingView {
  const today = londonToday()
  const from = addDays(today, -(days - 1))
  const list: ReadingDay[] = []
  for (let i = 0; i < days; i++) list.push(dayOf(addDays(from, i), today))
  const total_read = list.reduce((a, d) => a + d.read, 0)
  const minutes = list.reduce((a, d) => a + d.minutes, 0)
  const topics = TOPICS.map(({ name }) => {
    let read = 0
    let shown = 0
    for (const d of list) {
      const rec = db.issues.get(d.date)
      if (!rec) continue
      for (const s of issueStories(rec)) {
        if (s.topic !== name || s.hidden) continue
        shown++
        if (s.stats.reached_end) read++
      }
    }
    return { name, read, shown }
  })
  let too_fast = 0
  for (const d of list) {
    const rec = db.issues.get(d.date)
    if (rec) too_fast += issueStories(rec).filter((s) => !s.hidden && s.stats.too_fast).length
  }
  return {
    from,
    to: today,
    days: list,
    streak: streak(),
    reading_days: list.filter((d) => d.read > 0).length,
    total_read,
    avg_read_per_day: Math.round((total_read / days) * 10) / 10,
    avg_minutes_per_day: Math.round((minutes / days) * 10) / 10,
    too_fast,
    topics,
  }
}

export function calendarView(month: string): CalendarView {
  const today = londonToday()
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const days = []
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    const day = dayOf(date, today)
    days.push({ ...day, all_read: day.issue && day.stories > 0 && day.read >= day.stories })
  }
  const past = days.filter((d) => d.date <= today)
  return {
    month,
    days,
    total_read: past.reduce((a, d) => a + d.read, 0),
    reading_days: past.filter((d) => d.read > 0).length,
    all_read_days: past.filter((d) => d.all_read).length,
    elapsed_days: past.length,
  }
}

// --- share cards (reads are dated by their issue in the mock) ----------------
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500]

function readOn(date: string) {
  const rec = db.issues.get(date)
  return rec ? issueStories(rec).filter((s) => s.stats.reached_end) : []
}

const shareStory = (s: { id: number; topic: string; title: string; teaser: string }) => ({
  id: s.id,
  topic: s.topic,
  title: s.title,
  teaser: s.teaser,
})

export function shareView(): ShareView {
  const today = londonToday()
  const fortnight = readingView(14)
  const week = readingView(7)

  const ordered = [...db.issues.keys()].filter((d) => d <= today).sort().flatMap((d) => readOn(d).map((s) => ({ d, s })))
  const total = ordered.length
  const reached = total < 10 ? null : total >= 500 ? 500 + Math.floor((total - 500) / 100) * 100 : [...MILESTONES].reverse().find((m) => m <= total)!
  const hit = reached ? ordered[reached - 1] : null

  const words: ShareView['words'] = []
  const seen = new Set<string>()
  for (let d = today; d >= week.from && words.length < 4; d = addDays(d, -1)) {
    for (const s of readOn(d)) {
      if (!s.word_to_know || seen.has(s.word_to_know.word)) continue
      seen.add(s.word_to_know.word)
      words.push({ ...s.word_to_know, story_title: s.title })
      if (words.length === 4) break
    }
  }

  let askDate: string | null = null
  let ask: ReturnType<typeof shareStory>[] = []
  for (let d = today; d >= week.from; d = addDays(d, -1)) {
    const r = readOn(d)
    if (r.length) {
      askDate = d
      ask = r.slice(0, 3).map(shareStory)
      break
    }
  }

  const rec = db.issues.get(today)
  return {
    today,
    streak: fortnight.streak,
    fortnight: fortnight.days,
    today_read: {
      stories: readOn(today).map(shareStory),
      minutes: fortnight.days.at(-1)?.minutes ?? 0,
      in_paper: rec ? issueStories(rec).filter((s) => !s.hidden).length : 0,
    },
    week: {
      from: week.from,
      to: week.to,
      days: week.days,
      total_read: week.total_read,
      minutes: Math.round(week.days.reduce((a, d) => a + d.minutes, 0) * 10) / 10,
      reading_days: week.reading_days,
      top_topics: [...week.topics].filter((t) => t.read > 0).sort((a, b) => b.read - a.read).slice(0, 3).map((t) => t.name),
    },
    total_read: total,
    milestone:
      reached && hit
        ? { stories: reached, date: hit.d, story: shareStory(hit.s), next: MILESTONES.find((m) => m > reached) ?? reached + 100 }
        : null,
    words,
    ask: { date: askDate, stories: ask },
  }
}
