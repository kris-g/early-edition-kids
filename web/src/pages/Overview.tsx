import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { StoryCard } from '../api/types'
import { CalendarGrid } from '../components/CalendarGrid'
import { CostBars, Meter } from '../components/charts/Bars'
import { DayStrip } from '../components/charts/DayStrip'
import { ChartLegend, StoriesBarChart } from '../components/charts/StoriesBarChart'
import { AiRunRow, IssueBadges, KindlePill, NoDeviceYet } from '../components/home'
import { EyeIcon, EyeOffIcon } from '../components/Icons'
import { RangePills } from '../components/RangePills'
import type { RangeDays } from '../lib/ranges'
import { StatusPill } from '../components/StoryCardItem'
import { useRegenerate } from '../components/useRegenerate'
import { CatchUpLink } from '../components/CatchUpLink'
import { BigNumber, Button, ErrorNote, Eyebrow, LinkButton, Loading, SectionTitle, Spinner } from '../components/ui'
import { cx } from '../lib/cx'
import { londonToday, money, moneyShort, monthName, oneDecimal, plural, prettyModel } from '../lib/format'
import { visibleCount, withStory } from '../lib/issue'
import { useOrigin } from '../lib/origin'
import { useApi } from '../lib/useApi'
import { useHideToggle } from '../lib/useHideToggle'

const CARD = 'box-border flex flex-col rounded-2xl border border-line bg-card p-[22px]'

/** The desktop and tablet home page (900px and wider), after Desktop.dc.html. */
export function Overview() {
  const today = londonToday()
  const origin = useOrigin()
  const month = today.slice(0, 7)
  const [range, setRange] = useState<RangeDays>(14)
  const summary = useApi('summary', (s) => api.summary(s))
  const reading14 = useApi('reading:14', (s) => api.reading(14, s))
  const readingRange = useApi(range === 14 ? null : `reading:${range}`, (s) => api.reading(range, s))
  const calendar = useApi(`calendar:${month}`, (s) => api.calendar(month, s))
  const ai = useApi('ai', (s) => api.ai(s))

  const { mutate, reload } = summary
  const onStoryChange = useCallback(
    (card: StoryCard) => mutate((s) => (s && s.today ? { ...s, today: withStory(s.today, card) } : s)),
    [mutate],
  )
  const hide = useHideToggle(onStoryChange)
  const issue = summary.data?.today ?? null
  const regen = useRegenerate(issue, () => {
    reload()
    reading14.reload()
  })

  const chart = range === 14 ? reading14 : readingRange
  const r14 = reading14.data
  const streak = summary.data?.streak_detail ?? r14?.streak

  const fullDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${today}T12:00:00Z`))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-muted">{fullDate}</span>
          <h1 className="m-0 font-display text-[40px] leading-[1.1] font-black">Today</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <KindlePill issue={issue} seenAt={summary.data?.kindle_seen_at} large />
          <Button onClick={regen.start} busy={regen.running}>
            {issue ? 'Make it again' : 'Make today’s paper'}
          </Button>
          <LinkButton to="/find" variant="primary" className="px-[18px]">
            Add a story
          </LinkButton>
        </div>
      </div>
      {regen.status}
      {summary.error && <ErrorNote onRetry={reload}>{summary.error.message}</ErrorNote>}
      {!summary.data && summary.loading && <Loading />}
      {summary.data && <NoDeviceYet seenAt={summary.data.kindle_seen_at} />}

      <div className="flex flex-wrap gap-5">
        <section aria-label="Streak" className={cx(CARD, 'flex-[1_1_300px] gap-[18px]')}>
          <Eyebrow>Reading streak</Eyebrow>
          {streak && streak.current > 0 ? (
            <div className="flex items-baseline gap-2.5">
              <BigNumber className="text-[84px] leading-[0.95]">{streak.current}</BigNumber>
              <span className="text-lg font-semibold">{streak.current === 1 ? 'day' : 'days in a row'}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="font-display text-[34px] leading-tight font-black">No streak yet</span>
              <span className="text-sm text-muted">A streak starts on any day a story is read to the end.</span>
            </div>
          )}
          {r14 && streak && <DayStrip days={r14.days} streak={streak} tall />}
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold">{streak ? plural(streak.longest, 'day') : '–'}</span>
              <span className="text-xs text-muted">longest streak</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] font-bold">{r14 ? `${r14.reading_days} of ${r14.days.length}` : '–'}</span>
              <span className="text-xs text-muted">days with reading</span>
            </div>
          </div>
        </section>

        <section aria-label="Stories per day" className={cx(CARD, 'min-w-0 flex-[2_1_480px] gap-4')}>
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SectionTitle>Stories per day</SectionTitle>
            <RangePills value={range} onChange={setRange} />
          </div>
          {chart.error && <ErrorNote onRetry={chart.reload}>{chart.error.message}</ErrorNote>}
          {!chart.data && <Loading />}
          {chart.data && (
            <>
              <StoriesBarChart
                days={chart.data.days}
                average={chart.data.avg_read_per_day}
                height={190}
                labels="date"
              />
              <ChartLegend
                average={chart.data.avg_read_per_day}
                extra={`${plural(chart.data.total_read, 'story', 'stories')} · about ${oneDecimal(chart.data.avg_minutes_per_day)} minutes a day`}
              />
            </>
          )}
        </section>
      </div>

      <div className="flex flex-wrap gap-5">
        <section aria-label="Calendar" className={cx(CARD, 'flex-[1_1_340px] gap-3')}>
          <div className="flex items-baseline justify-between">
            <SectionTitle>{monthName(month)}</SectionTitle>
            <Link to="/calendar" className="flex min-h-11 items-center text-[13px] font-semibold text-accent">
              Open calendar
            </Link>
          </div>
          {calendar.data ? <CalendarGrid view={calendar.data} today={today} compact /> : <Loading />}
          <span className="text-xs text-muted">The small number is stories read that day. Darker means more.</span>
        </section>

        <section aria-label="AI and cost" className={cx(CARD, 'flex-[1_1_320px] gap-3.5')}>
          <div className="flex items-baseline justify-between">
            <SectionTitle>AI and cost</SectionTitle>
            <Link to="/ai" className="flex min-h-11 items-center text-[13px] font-semibold text-accent">
              Change model
            </Link>
          </div>
          {ai.error && <ErrorNote onRetry={ai.reload}>{ai.error.message}</ErrorNote>}
          {!ai.data && !ai.error && <Loading />}
          {ai.data && (
            <>
              <div className="flex flex-col gap-0.5 rounded-xl bg-chip px-3.5 py-3">
                <span className="text-[15px] font-bold">
                  {modelLine(ai.data.settings.writer_model, ai.data.settings.check_model, ai.data.models)}
                </span>
                <span className="text-xs text-muted">
                  {ai.data.settings.writer_model === ai.data.settings.check_model ? 'writes and checks' : 'writer and checker'}
                  {ai.data.last_run &&
                    ` · ${ai.data.last_run.date === today ? 'this morning' : 'last run'} ${
                      ai.data.last_run.seconds !== null ? `${Math.round(ai.data.last_run.seconds)} s, ` : ''
                    }${money(ai.data.last_run.cost_usd)}`}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <BigNumber className="text-[44px]">{money(ai.data.month.cost_usd)}</BigNumber>
                <span className="text-sm text-muted">
                  this month{ai.data.month.limit_usd !== null ? `, of ${moneyShort(ai.data.month.limit_usd)}` : ''}
                </span>
              </div>
              {ai.data.month.limit_usd !== null && ai.data.month.limit_usd > 0 && (
                <Meter
                  fraction={ai.data.month.cost_usd / ai.data.month.limit_usd}
                  tone="warm"
                  label={`${Math.round((ai.data.month.cost_usd / ai.data.month.limit_usd) * 100)} percent of the monthly limit used`}
                />
              )}
              <CostBars days={ai.data.month.days.slice(-14)} today={today} height={110} axis={false} />
              <div className="flex justify-between gap-2 text-xs text-muted">
                <span>Cost per day</span>
                <span>{plural(ai.data.quality.sent_back, 'story', 'stories')} sent back by the checker</span>
              </div>
            </>
          )}
        </section>

        <section aria-label="Today's paper" className={cx(CARD, 'flex-[1_1_340px] gap-1.5')}>
          <div className="flex items-baseline justify-between pb-2">
            <SectionTitle>Today’s paper</SectionTitle>
            {issue && (
              <span className="text-[13px] font-bold text-accent">
                {issue.read_count} of {visibleCount(issue)} read
              </span>
            )}
          </div>
          {issue && <IssueBadges issue={issue} />}
          {summary.data && <CatchUpLink count={summary.data.catch_up_today} today={today} />}
          {hide.error && <ErrorNote>{hide.error}</ErrorNote>}
          {!issue && summary.data && (
            <p className="border-t border-line pt-3 text-sm text-muted">
              No paper yet today. The daily run starts at 05:30; you can also make it now.
            </p>
          )}
          {issue &&
            [...issue.stories]
              .sort((a, b) => a.position - b.position)
              .map((s) => (
                <div key={s.id} className="flex items-center gap-2 border-t border-line py-2.5">
                  <Link to={`/story/${s.id}`} state={origin} className="flex min-w-0 flex-1 flex-col gap-[5px] rounded">
                    <span className={cx('text-sm leading-[1.3] font-semibold', s.hidden && 'line-through decoration-muted')}>
                      {s.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted">{s.topic}</span>
                      <StatusPill stats={s.stats} short />
                      {s.hidden && <span className="font-bold text-warm">Hidden</span>}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void hide.toggle(s)}
                    disabled={hide.busyId === s.id}
                    aria-label={`${s.hidden ? 'Unhide' : 'Hide'} "${s.title}"`}
                    title={s.hidden ? 'Unhide' : 'Hide'}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-chip hover:text-ink"
                  >
                    {hide.busyId === s.id ? (
                      <Spinner />
                    ) : s.hidden ? (
                      <EyeIcon className="size-[18px]" />
                    ) : (
                      <EyeOffIcon className="size-[18px]" />
                    )}
                  </button>
                </div>
              ))}
        </section>
      </div>

      {summary.data && <AiRunRow run={summary.data.last_run_cost} today={today} />}
      {regen.dialog}
    </div>
  )
}

function modelLine(writer: string, checker: string, models: { id: string; name: string }[]): string {
  const name = (id: string) => models.find((m) => m.id === id)?.name ?? prettyModel(id)
  return writer === checker ? name(writer) : `${name(writer)} and ${name(checker)}`
}
