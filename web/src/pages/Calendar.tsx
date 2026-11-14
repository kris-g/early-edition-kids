import { useSearchParams } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { CalendarView, IssueView } from '../api/types'
import { CalendarGrid, CalendarLegend } from '../components/CalendarGrid'
import { CheckCircleIcon, ChevronLeft, ChevronRight, EmptyCircleIcon, HalfCircleIcon } from '../components/Icons'
import { BigNumber, Card, ErrorNote, LinkButton, Loading, PageHeader, SectionTitle } from '../components/ui'
import { cx } from '../lib/cx'
import { addMonths, clockTime, duration, londonToday, monthTitle, weekdayDayMonth } from '../lib/format'
import { useApi } from '../lib/useApi'

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

  const go = (m: string) => setParams({ month: m }, { replace: true })
  const select = (date: string) => setParams({ month, day: date }, { replace: true })

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
          </div>
          {picked && <DayPanel date={picked} view={view} today={today} />}
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

function DayPanel({ date, view, today }: { date: string; view: CalendarView; today: string }) {
  const info = view.days.find((d) => d.date === date)
  const issue = useApi(info?.issue ? `issue:${date}` : null, (s) => api.issue(date, s))
  const read = info?.read ?? 0
  const stories = info?.stories ?? 0
  const summary = !info?.issue
    ? read > 0
      ? `${read} read`
      : 'No paper'
    : info.all_read
      ? `All ${stories} read`
      : `${read} of ${stories} read`
  return (
    <Card label="Selected day" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>{weekdayDayMonth(date)}</SectionTitle>
        <span className="text-[13px] font-bold whitespace-nowrap text-accent">{summary}</span>
      </div>
      {!info?.issue && (
        <p className="m-0 text-sm leading-[1.45] text-muted">
          There was no paper that day{read > 0 ? `, but he read ${read} from an earlier one` : ''}.
        </p>
      )}
      {info?.issue && issue.error && <ErrorNote onRetry={issue.reload}>{issue.error.message}</ErrorNote>}
      {info?.issue && !issue.data && !issue.error && <Loading />}
      {issue.data && <DayStories issue={issue.data} read={read} />}
      {info?.issue && (
        <LinkButton to={date === today ? '/' : `/issues/${date}`} className="min-h-[46px]">
          Open this day’s paper
        </LinkButton>
      )}
    </Card>
  )
}

function DayStories({ issue, read }: { issue: IssueView; read: number }) {
  const first = issue.downloaded_by[0]
  const stories = [...issue.stories].filter((s) => !s.hidden).sort((a, b) => a.position - b.position)
  return (
    <>
      {read === 0 && (
        <p className="m-0 text-sm leading-[1.45] text-muted">
          No stories read.
          {first ? ` The paper was on the Kindle from ${clockTime(first.received_at)}, so it was there if he wanted it.` : ''}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {stories.map((s) => {
          const state = s.stats.reached_end ? 'read' : s.stats.opened ? 'opened' : 'none'
          const label = state === 'read' ? 'Read to the end' : state === 'opened' ? 'Opened' : 'Not opened'
          return (
            <li key={s.id} className="box-border flex min-h-11 items-center gap-3 border-t border-line py-[11px]">
              <span role="img" aria-label={label} className={cx('shrink-0', state === 'none' ? 'text-muted' : state === 'opened' ? 'text-warm' : 'text-accent')}>
                {state === 'read' ? (
                  <CheckCircleIcon className="size-5" />
                ) : state === 'opened' ? (
                  <HalfCircleIcon className="size-5" />
                ) : (
                  <EmptyCircleIcon className="size-5" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm leading-[1.3] font-semibold">{s.title}</span>
                <span className="text-xs text-muted">
                  {s.topic}
                  {s.stats.opened ? ` · ${duration(s.stats.active_seconds)}` : ''}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
