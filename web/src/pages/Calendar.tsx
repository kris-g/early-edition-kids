import { useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { CalendarView, StoryCard } from '../api/types'
import { CalendarGrid, CalendarLegend } from '../components/CalendarGrid'
import { ChevronLeft, ChevronRight } from '../components/Icons'
import { BigNumber, Card, ErrorNote, Loading, PageHeader, SectionTitle } from '../components/ui'
import { dayPath, type DayMode } from '../lib/day'
import { addMonths, londonToday, monthTitle, weekdayDayMonth } from '../lib/format'
import { withStory } from '../lib/issue'
import { useOrigin } from '../lib/origin'
import { useApi } from '../lib/useApi'
import { ModeSwitch, PaperOfDay, ReadThatDay } from './Day'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function defaultDay(view: CalendarView, today: string): string | null {
  if (today.startsWith(view.month)) return today
  const withIssue = view.days.filter((d) => d.issue && d.date <= today)
  return withIssue.length ? withIssue[withIssue.length - 1].date : null
}

export function Calendar() {
  const today = londonToday()
  const thisMonth = today.slice(0, 7)
  const [params, setParams] = useSearchParams()
  const asked = params.get('month') ?? ''
  const month = MONTH_RE.test(asked) && asked <= thisMonth ? asked : thisMonth
  const cal = useApi(`calendar:${month}`, (s) => api.calendar(month, s))
  const view = cal.data && cal.data.month === month ? cal.data : undefined
  const pickedParam = params.get('day')
  const picked =
    pickedParam && pickedParam.startsWith(month) && pickedParam <= today
      ? pickedParam
      : view
        ? defaultDay(view, today)
        : null

  const origin = useOrigin()
  const go = (m: string) => setParams({ month: m }, { replace: true })
  const dayView = params.get('view') === 'paper' ? 'paper' : 'read'
  const select = (date: string) => setParams({ month, day: date, ...(dayView === 'paper' ? { view: 'paper' } : {}) }, { replace: true })
  const setView = (m: DayMode) =>
    setParams({ month, ...(picked ? { day: picked } : {}), ...(m === 'paper' ? { view: 'paper' } : {}) }, { replace: true })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        size="md"
        title={monthTitle(month)}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => go(addMonths(month, -1))}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink hover:bg-chip"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next month"
              disabled={month >= thisMonth}
              onClick={() => go(addMonths(month, 1))}
              className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink hover:bg-chip disabled:cursor-default disabled:bg-transparent disabled:text-muted disabled:hover:bg-transparent"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        }
      />

      {cal.error && <ErrorNote onRetry={cal.reload}>{cal.error.message}</ErrorNote>}
      {!view && !cal.error && <Loading />}

      {view && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 desk:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] desk:items-start">
          <div className="flex flex-col gap-4">
            <Card label="Month" className="flex flex-col gap-2.5 p-3.5">
              <CalendarGrid view={view} today={today} selected={picked} onSelect={select} />
              <CalendarLegend />
            </Card>
            <div className="grid grid-cols-3 gap-2.5">
              <Total value={view.total_read} label={view.total_read === 1 ? 'story this month' : 'stories this month'} />
              <Total value={view.reading_days} label={`of ${view.elapsed_days} days read`} />
              <Total value={view.all_read_days} label={view.all_read_days === 1 ? 'all-read day' : 'all-read days'} />
            </div>
            <Link
              to="/issues"
              state={origin}
              className="inline-flex min-h-11 items-center gap-1 self-start text-[13px] font-bold text-accent hover:underline"
            >
              Back issues: every paper as a list
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {picked && <DayPanel key={picked} date={picked} today={today} mode={dayView} onMode={setView} />}
        </div>
      )}
    </div>
  )
}

function Total({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[14px] border border-line bg-card px-3.5 py-3">
      <BigNumber className="text-[30px] leading-[1.1]">{value}</BigNumber>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

function DayPanel({
  date,
  today,
  mode,
  onMode: setMode,
}: {
  date: string
  today: string
  mode: DayMode
  onMode: (m: DayMode) => void
}) {
  const origin = useOrigin()
  const day = useApi(`day:${date}`, (s) => api.day(date, s))
  const { mutate } = day
  const onStoryChange = useCallback(
    (card: StoryCard) => mutate((d) => (d && d.paper ? { ...d, paper: withStory(d.paper, card) } : d)),
    [mutate],
  )
  const data = day.data?.date === date ? day.data : undefined
  return (
    <section aria-label="Selected day" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>{weekdayDayMonth(date)}</SectionTitle>
        <Link to={dayPath(date, mode)} state={origin} className="text-[13px] font-bold whitespace-nowrap text-accent hover:underline">
          Open day
        </Link>
      </div>
      <ModeSwitch mode={mode} onChange={setMode} isToday={date === today} />
      {day.error && !data && <ErrorNote onRetry={day.reload}>{day.error.message}</ErrorNote>}
      {!data && !day.error && <Loading />}
      {data &&
        (mode === 'read' ? (
          <ReadThatDay day={data} today={today} onShowPaper={() => setMode('paper')} />
        ) : (
          <PaperOfDay day={data} onStoryChange={onStoryChange} />
        ))}
    </section>
  )
}
