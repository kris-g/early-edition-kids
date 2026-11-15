import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import { Meter } from '../components/charts/Bars'
import { DayStrip } from '../components/charts/DayStrip'
import { MinutesLineChart } from '../components/charts/MinutesLineChart'
import { ChartLegend, StoriesBarChart } from '../components/charts/StoriesBarChart'
import { RangePills } from '../components/RangePills'
import { BigNumber, Card, ErrorNote, Eyebrow, Loading, PageHeader, SectionTitle } from '../components/ui'
import { dayMonthLong, plural, rangeLabel, weekdayDayMonth } from '../lib/format'
import type { RangeDays } from '../lib/ranges'
import { topicTip } from '../lib/tips'
import { useApi } from '../lib/useApi'

export function Reading() {
  const [range, setRange] = useState<RangeDays>(14)
  const reading = useApi(`reading:${range}`, (signal) => api.reading(range, signal))
  const r = reading.data

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reading" subtitle={r ? rangeLabel(r.from, r.to) : ' '} />
      <RangePills value={range} onChange={setRange} />

      {reading.error && <ErrorNote onRetry={reading.reload}>{reading.error.message}</ErrorNote>}
      {!r && reading.loading && <Loading />}

      {r && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 desk:grid-cols-2">
          <Card label="Streak" className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Eyebrow>Streak now</Eyebrow>
                <span className="flex items-baseline gap-1.5">
                  <BigNumber className="text-[52px]">{r.streak.current}</BigNumber>
                  <span className="text-sm font-semibold">{r.streak.current === 1 ? 'day' : 'days'}</span>
                </span>
                <span className="text-xs text-muted">
                  {r.streak.current > 0 && r.streak.current_since
                    ? `Since ${weekdayDayMonth(r.streak.current_since)}`
                    : 'Starts on the next reading day'}
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 border-l border-line pl-3.5">
                <Eyebrow>Longest</Eyebrow>
                <span className="flex items-baseline gap-1.5">
                  <BigNumber className="text-[52px]">{r.streak.longest}</BigNumber>
                  <span className="text-sm font-semibold">{r.streak.longest === 1 ? 'day' : 'days'}</span>
                </span>
                <span className="text-xs text-muted">
                  {r.streak.longest_from && r.streak.longest_to
                    ? r.streak.longest_from === r.streak.longest_to
                      ? dayMonthLong(r.streak.longest_from)
                      : rangeLabel(r.streak.longest_from, r.streak.longest_to)
                    : ' '}
                </span>
              </div>
            </div>
            <DayStrip days={r.days} streak={r.streak} />
            <p className="m-0 text-sm leading-[1.45]">
              Reading on{' '}
              <strong>
                {r.reading_days} of the last {r.days.length} days
              </strong>
              . A streak counts any day with at least one story read to the end.
            </p>
          </Card>

          <Card label="Stories per day" className="flex flex-col gap-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <SectionTitle>Stories per day</SectionTitle>
              <span className="text-[13px] text-muted">
                {r.total_read} in {r.days.length} days
              </span>
            </div>
            <StoriesBarChart days={r.days} average={r.avg_read_per_day} />
            <ChartLegend average={r.avg_read_per_day} />
          </Card>

          <Card label="Time reading" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <SectionTitle>Time reading</SectionTitle>
              <span className="text-[13px] text-muted">
                About {plural(Math.round(r.avg_minutes_per_day), 'minute')} a day
              </span>
            </div>
            <MinutesLineChart days={r.days} />
          </Card>

          <Card label="Topics" className="flex flex-col gap-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <SectionTitle>What gets read</SectionTitle>
              <Link to="/topics" className="flex min-h-11 items-center text-[13px] font-semibold text-accent">
                Manage topics
              </Link>
            </div>
            {r.topics.length === 0 && <p className="text-sm text-muted">No stories in this range yet.</p>}
            {r.topics.map((t) => (
              <div key={t.name} className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-muted">
                    {t.shown > 0 ? `${t.read} of ${t.shown} read` : 'none shown'}
                  </span>
                </div>
                <Meter fraction={t.shown > 0 ? t.read / t.shown : 0} label={topicTip(t.name, t.read, t.shown)} tip />
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
