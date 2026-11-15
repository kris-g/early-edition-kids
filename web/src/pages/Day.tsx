import { useCallback, useRef } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { DayRead, DayView, StoryCard } from '../api/types'
import { CalendarIcon, CheckCircleIcon, ChevronLeft, ChevronRight, HalfCircleIcon } from '../components/Icons'
import { DownloadedBy, IssueStories } from '../components/IssueStories'
import { BackLink } from '../components/BackLink'
import { IssueBadges } from '../components/home'
import { BigNumber, Card, ErrorNote, Eyebrow, Loading, PageHeader, Segment, SectionTitle } from '../components/ui'
import { cx } from '../lib/cx'
import { dayPath, type DayMode } from '../lib/day'
import { useOrigin } from '../lib/origin'
import { addDaysIso, clockTime, duration, londonToday, plural, weekdayDayMonth, weekdayDayMonthShort } from '../lib/format'
import { visibleCount, withStory } from '../lib/issue'
import { useApi } from '../lib/useApi'
import { DESK_QUERY, useMedia } from '../lib/useMedia'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** "Today", "Yesterday" or nothing, above the date. */
function relative(date: string, today: string): string | undefined {
  if (date === today) return 'Today'
  if (date === addDaysIso(today, -1)) return 'Yesterday'
  return undefined
}

/** Old links to /issues/:date open the paper view of that day. */
export function IssueRedirect() {
  const { date = '' } = useParams()
  return <Navigate to={dayPath(date, 'paper')} replace />
}

/**
 * One day, two ways: what he read that day (from any paper) and that day's own
 * paper. A phone switches between them; a wide screen shows both side by side.
 */
export function Day() {
  const { date = '' } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const desk = useMedia(DESK_QUERY)
  const today = londonToday()
  const valid = DATE_RE.test(date) && date <= today
  const mode: DayMode = params.get('view') === 'paper' ? 'paper' : 'read'
  const day = useApi(valid ? `day:${date}` : null, (s) => api.day(date, s))
  const { mutate } = day
  const onStoryChange = useCallback(
    (card: StoryCard) => mutate((d) => (d && d.paper ? { ...d, paper: withStory(d.paper, card) } : d)),
    [mutate],
  )

  // Moving sideways (another day, the other view) replaces this page in the
  // history and keeps where it was opened from, so back still goes there.
  const go = (d: string) => navigate(dayPath(d, mode), { replace: true, state: location.state })
  const setMode = (m: DayMode) => navigate(dayPath(date, m), { replace: true, state: location.state })

  if (!valid) return <ErrorNote>That date is not right.</ErrorNote>
  const data = day.data?.date === date ? day.data : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <BackLink fallback={{ to: `/calendar?month=${date.slice(0, 7)}&day=${date}`, label: 'Calendar' }} />
        <PageHeader
          title={weekdayDayMonth(date)}
          subtitle={relative(date, today) ?? date.slice(0, 4)}
          action={desk ? <DayNav date={date} today={today} onGo={go} /> : undefined}
        />
        {!desk && <DayNav date={date} today={today} onGo={go} wide />}
      </div>
      {day.error && !data && <ErrorNote onRetry={day.reload}>{day.error.message}</ErrorNote>}
      {!data && !day.error && <Loading />}
      {data && desk && (
        <div className="grid grid-cols-2 items-start gap-4">
          <section aria-label="Read that day" className="flex flex-col gap-3">
            <ColumnTitle>{date === today ? 'Read today' : 'Read that day'}</ColumnTitle>
            <ReadThatDay day={data} today={today} />
          </section>
          <section aria-label="That day’s paper" className="flex flex-col gap-3">
            <ColumnTitle>{date === today ? 'Today’s paper' : 'That day’s paper'}</ColumnTitle>
            <PaperOfDay day={data} onStoryChange={onStoryChange} />
          </section>
        </div>
      )}
      {data && !desk && (
        <>
          <ModeSwitch mode={mode} onChange={setMode} isToday={date === today} />
          {mode === 'read' ? (
            <ReadThatDay day={data} today={today} onShowPaper={() => setMode('paper')} />
          ) : (
            <PaperOfDay day={data} onStoryChange={onStoryChange} />
          )}
        </>
      )}
    </div>
  )
}

function ColumnTitle({ children }: { children: string }) {
  return <SectionTitle className="mt-1">{children}</SectionTitle>
}

/**
 * Previous and next day, and a date picker on the calendar button. `wide` (phones)
 * is a row of its own that names the days either side.
 */
function DayNav({ date, today, onGo, wide }: { date: string; today: string; onGo: (date: string) => void; wide?: boolean }) {
  const picker = useRef<HTMLInputElement>(null)
  const prev = addDaysIso(date, -1)
  const next = addDaysIso(date, 1)
  const pick = () => {
    const el = picker.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }
  const input = (
    <input
      ref={picker}
      type="date"
      tabIndex={-1}
      aria-hidden="true"
      max={today}
      value={date}
      onChange={(e) => e.target.value && e.target.value <= today && onGo(e.target.value)}
      className="pointer-events-none absolute inset-0 opacity-0"
    />
  )
  if (wide) {
    const btn =
      'flex min-h-11 items-center justify-center gap-1 rounded-[10px] border border-line bg-card px-2 text-[13px] font-bold text-ink hover:bg-chip disabled:cursor-default disabled:border-dashed disabled:bg-transparent disabled:text-muted'
    return (
      <div role="group" aria-label="Change day" className="grid grid-cols-[1fr_auto_1fr] gap-1.5">
        <button type="button" className={cx(btn, 'justify-start')} onClick={() => onGo(prev)} aria-label={`Previous day, ${weekdayDayMonthShort(prev)}`}>
          <ChevronLeft className="size-4 shrink-0" />
          {weekdayDayMonthShort(prev)}
        </button>
        <span className="relative">
          <button type="button" className={cx(btn, 'h-full px-3.5')} onClick={pick} aria-label="Pick a day">
            <CalendarIcon className="size-[18px]" />
          </button>
          {input}
        </span>
        <button
          type="button"
          className={cx(btn, 'justify-end')}
          disabled={date >= today}
          onClick={() => onGo(next)}
          aria-label={date >= today ? 'No next day yet' : `Next day, ${weekdayDayMonthShort(next)}`}
        >
          {date >= today ? 'Next' : weekdayDayMonthShort(next)}
          <ChevronRight className="size-4 shrink-0" />
        </button>
      </div>
    )
  }
  const round =
    'flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink hover:bg-chip disabled:cursor-default disabled:bg-transparent disabled:text-muted disabled:hover:bg-transparent'
  return (
    <div className="flex gap-2">
      <button type="button" aria-label="Previous day" className={round} onClick={() => onGo(prev)}>
        <ChevronLeft className="size-5" />
      </button>
      <span className="relative">
        <button type="button" aria-label="Pick a day" className={round} onClick={pick}>
          <CalendarIcon className="size-5" />
        </button>
        {input}
      </span>
      <button type="button" aria-label="Next day" className={round} disabled={date >= today} onClick={() => onGo(next)}>
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}

export function ModeSwitch({
  mode,
  onChange,
  isToday,
}: {
  mode: DayMode
  onChange: (m: DayMode) => void
  isToday: boolean
}) {
  return (
    <div role="group" aria-label="Show" className="grid grid-cols-2 gap-1.5">
      <Segment pressed={mode === 'read'} onClick={() => onChange('read')}>
        {isToday ? 'Read today' : 'Read that day'}
      </Segment>
      <Segment pressed={mode === 'paper'} onClick={() => onChange('paper')}>
        {isToday ? 'Today’s paper' : 'That day’s paper'}
      </Segment>
    </div>
  )
}

/** Everything he read on the day: that day's paper first, then catching up, by paper. */
export function ReadThatDay({
  day,
  today,
  onShowPaper,
  compact,
}: {
  day: DayView
  today: string
  onShowPaper?: () => void
  compact?: boolean
}) {
  const own = day.reads.filter((r) => r.story.date === day.date)
  const earlier = day.reads.filter((r) => r.story.date !== day.date)
  const papers = [...new Set(earlier.map((r) => r.story.date))].sort()
  const ownRead = own.filter((r) => r.finished).length
  const catchUp = earlier.filter((r) => r.finished).length
  const laterReads = day.paper?.stories.filter((s) => s.stats.read_on && s.stats.read_on > day.date).length ?? 0
  const isToday = day.date === today

  if (day.reads.length === 0) {
    return (
      <Card label="Nothing read" className="flex flex-col gap-2">
        <span className="font-display text-[26px] leading-tight font-black">Nothing read</span>
        <p className="m-0 text-sm leading-[1.45] text-muted">
          {isToday ? 'He hasn’t read anything yet today.' : 'He didn’t read anything this day.'}
          {laterReads > 0 && ` ${plural(laterReads, 'story', 'stories')} from this day’s paper ${laterReads === 1 ? 'was' : 'were'} read later.`}
        </p>
        {laterReads > 0 && onShowPaper && (
          <button type="button" onClick={onShowPaper} className="self-start text-sm font-bold text-accent hover:underline">
            See this day’s paper
          </button>
        )}
      </Card>
    )
  }

  const parts = [
    day.paper ? `${ownRead} from ${isToday ? 'today’s' : 'this day’s'} paper` : null,
    catchUp > 0 ? `${catchUp} catching up` : null,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <Card label="Day total" className="flex flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <BigNumber className="text-[40px]">{day.read}</BigNumber>
            <span className="text-[15px] font-bold">{day.read === 1 ? 'story read' : 'stories read'}</span>
            <span className="text-sm text-muted">· {plural(Math.round(day.minutes), 'minute')}</span>
          </span>
          {parts.length > 0 && <span className="text-[13px] text-muted">{parts.join(' · ')}</span>}
        </Card>
      )}
      {own.length > 0 && (
        <ReadGroup title={isToday ? 'From today’s paper' : 'From this day’s paper'} reads={own} showPaper={false} />
      )}
      {papers.map((p) => (
        <ReadGroup
          key={p}
          title={`Catching up · ${weekdayDayMonthShort(p)} paper`}
          link={dayPath(p, 'paper')}
          reads={earlier.filter((r) => r.story.date === p)}
          showPaper
        />
      ))}
    </div>
  )
}

function ReadGroup({ title, reads, link }: { title: string; reads: DayRead[]; showPaper: boolean; link?: string }) {
  const origin = useOrigin()
  return (
    <Card label={title} className="flex flex-col gap-1 pt-3.5 pb-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow>{title}</Eyebrow>
        {link && (
          <Link to={link} state={origin} className="text-xs font-bold whitespace-nowrap text-accent hover:underline">
            Open paper
          </Link>
        )}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {reads.map((r) => (
          <li key={r.story.id} className="border-t border-line first:border-t-0">
            <Link to={`/story/${r.story.id}`} state={origin} className="flex min-h-11 items-center gap-3 py-[11px]">
              <span
                role="img"
                aria-label={r.finished ? 'Read to the end' : 'Opened'}
                className={cx('shrink-0', r.finished ? 'text-accent' : 'text-warm')}
              >
                {r.finished ? <CheckCircleIcon className="size-5" /> : <HalfCircleIcon className="size-5" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm leading-[1.3] font-semibold">{r.story.title}</span>
                <span className="text-xs text-muted">
                  {r.story.topic} · {clockTime(r.at)} · {duration(r.active_seconds)}
                  {!r.finished && ' · not finished'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** That day's own paper, each story saying when it was read. */
export function PaperOfDay({ day, onStoryChange }: { day: DayView; onStoryChange: (card: StoryCard) => void }) {
  const paper = day.paper
  if (!paper) {
    return (
      <Card label="No paper" className="flex flex-col gap-1">
        <span className="font-display text-[26px] leading-tight font-black">No paper</span>
        <p className="m-0 text-sm text-muted">There was no paper this day.</p>
      </Card>
    )
  }
  const total = visibleCount(paper)
  const later = paper.stories.filter((s) => s.stats.read_on && s.stats.read_on > day.date).length
  return (
    <div className="flex flex-col gap-3">
      <Card label="Paper progress" className="flex flex-col gap-2">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <BigNumber className="text-[40px]">
            {paper.read_count} of {total}
          </BigNumber>
          <span className="text-[15px] font-bold">read</span>
        </span>
        {later > 0 && (
          <span className="text-[13px] text-muted">
            {later === paper.read_count ? (later === 1 ? 'Read' : 'All read') : `${later} read`} on a later day
          </span>
        )}
        <DownloadedBy issue={paper} />
        <IssueBadges issue={paper} />
      </Card>
      <IssueStories issue={paper} onStoryChange={onStoryChange} />
    </div>
  )
}
