// What each share card says, built from GET /api/dashboard/share and the name the parent typed.
// Pure functions: the drawing lives in shareDraw.ts. The name never leaves the browser.
import type { ShareStory, ShareView } from '../api/types'
import { dayMonthShort, plural, weekdayDayMonth, weekdayShortDay } from './format'

export type CardId = 'streak' | 'today' | 'week' | 'milestone' | 'words' | 'ask'

export const CARD_IDS: CardId[] = ['streak', 'today', 'week', 'milestone', 'words', 'ask']

export const CARD_INFO: Record<CardId, { title: string; desc: string }> = {
  streak: { title: 'Streak', desc: 'Days in a row, with the last two weeks' },
  today: { title: 'Today', desc: 'The stories finished today' },
  week: { title: 'The week', desc: 'Stories, minutes and days over the last 7 days' },
  milestone: { title: 'Milestone', desc: 'The latest big number: 10, 25, 50, 100 stories and on' },
  words: { title: 'Words learned', desc: 'The word to know from stories read this week' },
  ask: { title: 'Ask me about', desc: 'Things for family to ask about' },
}

type Base = {
  id: CardId
  title: string
  ready: boolean
  /** Why the card can't be made yet (when not ready). */
  empty: string
  /** A plain-text description of the picture, for screen readers. */
  alt: string
  /** Masthead date, e.g. "SAT 14 NOV 2026". */
  dateLabel: string
  filename: string
}

export type DayState = 'current' | 'read' | 'missed' | 'pending'

export type StreakCard = Base & {
  id: 'streak'
  count: number
  sentence: string
  days: { letter: string; state: DayState }[]
  fromLabel: string
  missedNote: string
  daysRead: number
  longest: number
}

export type TodayCard = Base & {
  id: 'today'
  headline: string
  chips: string[]
  stories: ShareStory[]
  more: number
}

export type WeekCard = Base & {
  id: 'week'
  headline: string
  stories: number
  minutes: number
  daysRead: number
  bars: { letter: string; read: number }[]
  topics: string[]
}

export type MilestoneCard = Base & {
  id: 'milestone'
  stories: number
  headline: string
  sentence: string
  storyTitle: string | null
  next: number
}

export type WordsCard = Base & {
  id: 'words'
  headline: string
  words: { word: string; definition: string; story_title: string }[]
}

export type AskCard = Base & {
  id: 'ask'
  headline: string
  stories: ShareStory[]
  footer: string
}

export type ShareCard = StreakCard | TodayCard | WeekCard | MilestoneCard | WordsCard | AskCard

/** Trimmed, single-spaced and at most 20 characters. Empty means "no name on the cards". */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 20).trim()
}

/** "Sam" -> "Sam’s", "James" -> "James’" */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts })
const at = (date: string) => new Date(`${date}T12:00:00Z`)

/** "SAT 14 NOV 2026" */
export function mastheadDate(date: string): string {
  return fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .format(at(date))
    .replace(/,/g, '')
    .toUpperCase()
}

/** "8 – 14 NOV 2026" (or "28 OCT – 3 NOV 2026" across a month) */
export function mastheadRange(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7)
  const start = sameMonth ? fmt({ day: 'numeric' }).format(at(from)) : fmt({ day: 'numeric', month: 'short' }).format(at(from))
  const end = fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(at(to))
  return `${start} – ${end}`.toUpperCase()
}

const letter = (date: string) => fmt({ weekday: 'short' }).format(at(date)).charAt(0)
const weekday = (date: string) => fmt({ weekday: 'long' }).format(at(date))

function milestoneHeadline(n: number): string {
  switch (n) {
    case 10:
      return 'Double figures!'
    case 50:
      return 'Half a century!'
    case 100:
      return 'A century!'
    default:
      return `${n} stories!`
  }
}

export function buildCards(view: ShareView, rawName: string): ShareCard[] {
  const name = cleanName(rawName)
  const today = view.today
  const base = <T extends CardId>(id: T) => ({
    id,
    title: CARD_INFO[id].title,
    dateLabel: mastheadDate(today),
    filename: `early-edition-${id}-${today}.png`,
  })

  // ---- streak ----
  const s = view.streak
  const days = view.fortnight.map((d) => {
    let state: DayState
    if (d.read > 0) state = s.current_since && d.date >= s.current_since && s.current > 0 ? 'current' : 'read'
    else state = d.date === today ? 'pending' : 'missed'
    return { letter: letter(d.date), state }
  })
  const missed = view.fortnight.filter((d) => d.read === 0 && d.date !== today)
  const missedNote =
    missed.length === 0
      ? 'Not one day missed'
      : missed.length === 1
        ? `Missed one: ${weekdayShortDay(missed[0].date)}`
        : `${missed.length} days missed`
  const daysRead = view.fortnight.filter((d) => d.read > 0).length
  const since = s.current_since ? weekdayDayMonth(s.current_since) : ''
  const streak: StreakCard = {
    ...base('streak'),
    ready: s.current >= 2,
    empty:
      s.current === 1
        ? 'One day so far. The streak card is ready after a second day in a row.'
        : 'No streak right now. It starts again on the next reading day.',
    count: s.current,
    sentence: name
      ? `${name} has read the news every day since ${since}.`
      : `Reading the news every day since ${since}.`,
    days,
    fromLabel: view.fortnight.length ? dayMonthShort(view.fortnight[0].date) : '',
    missedNote,
    daysRead,
    longest: s.longest,
    alt: `Reading streak: ${plural(s.current, 'day')} in a row since ${since}. Read on ${daysRead} of the last 14 days. Longest streak ${plural(s.longest, 'day')}.`,
  }

  // ---- today ----
  const t = view.today_read
  const n = t.stories.length
  const todayCard: TodayCard = {
    ...base('today'),
    ready: n > 0,
    empty: 'Nothing finished yet today. This card fills in once a story is read to the end.',
    headline: name ? `${name} read ${plural(n, 'story', 'stories')} today` : `${plural(n, 'story', 'stories')} read today`,
    chips: [
      plural(Math.max(1, Math.round(t.minutes)), 'minute') + ' reading',
      ...(t.in_paper > 0 ? [`${Math.min(n, t.in_paper)} of ${t.in_paper} in today’s paper`] : []),
    ],
    stories: t.stories.slice(0, 3),
    more: Math.max(0, n - 3),
    alt: `${plural(n, 'story', 'stories')} read today: ${t.stories.map((x) => x.title).join('; ')}.`,
  }

  // ---- week ----
  const w = view.week
  const weekCard: WeekCard = {
    ...base('week'),
    dateLabel: mastheadRange(w.from, w.to),
    ready: w.total_read > 0,
    empty: 'Nothing read in the last 7 days.',
    headline:
      w.reading_days === 7
        ? name
          ? `${name} read every single day`
          : 'Read every single day'
        : name
          ? `${name} read on ${w.reading_days} of 7 days`
          : `Read on ${w.reading_days} of 7 days`,
    stories: w.total_read,
    minutes: Math.round(w.minutes),
    daysRead: w.reading_days,
    bars: w.days.map((d) => ({ letter: letter(d.date), read: d.read })),
    topics: w.top_topics,
    alt: `The last 7 days: ${plural(w.total_read, 'story', 'stories')}, ${plural(Math.round(w.minutes), 'minute')} reading, on ${w.reading_days} of 7 days.${w.top_topics.length ? ` Favourite topics: ${w.top_topics.join(', ')}.` : ''}`,
  }

  // ---- milestone ----
  const m = view.milestone
  const when = m ? (m.date === today ? 'today' : `on ${weekdayDayMonth(m.date)}`) : ''
  const milestone: MilestoneCard = {
    ...base('milestone'),
    ready: m !== null,
    empty: `Milestones start at 10 stories. ${plural(view.total_read, 'story', 'stories')} read so far.`,
    stories: m?.stories ?? 0,
    headline: m ? milestoneHeadline(m.stories) : '',
    sentence: m ? (name ? `${name} read story number ${m.stories} ${when}:` : `Story number ${m.stories} was read ${when}:`) : '',
    storyTitle: m?.story?.title ?? null,
    next: m?.next ?? 10,
    alt: m
      ? `Milestone: ${m.stories} stories read. Story number ${m.stories}${m.story ? `, “${m.story.title}”,` : ''} was read ${when}.`
      : '',
  }

  // ---- words ----
  const k = view.words.length
  const wordsCard: WordsCard = {
    ...base('words'),
    dateLabel: mastheadRange(w.from, w.to),
    ready: k > 0,
    empty: 'No words to know from this week’s stories yet.',
    headline: name ? `${plural(k, 'new word')} in ${possessive(name)} week` : `${plural(k, 'new word')} this week`,
    words: view.words,
    alt: `Words to know this week: ${view.words.map((x) => `${x.word}, ${x.definition}`).join('; ')}.`,
  }

  // ---- ask ----
  const a = view.ask
  const askCard: AskCard = {
    ...base('ask'),
    ready: a.stories.length > 0,
    empty: 'Nothing read in the last 7 days to ask about.',
    headline: name ? `Ask ${name} about…` : 'Ask me about…',
    stories: a.stories,
    footer: a.date
      ? `${name ? `${name} read ${a.stories.length === 1 ? 'this' : 'these'}` : 'Read'} ${a.date === today ? 'today' : `on ${weekday(a.date)}`}.`
      : '',
    alt: `Ask about: ${a.stories.map((x) => x.title).join('; ')}.`,
  }

  return [streak, todayCard, weekCard, milestone, wordsCard, askCard]
}
