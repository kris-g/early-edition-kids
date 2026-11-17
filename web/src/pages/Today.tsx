import { useCallback } from 'react'
import { api } from '../api/endpoints'
import type { StoryCard } from '../api/types'
import { AiRunRow, IssueBadges, KindlePill, NoDeviceYet, StreakCard } from '../components/home'
import { CatchUpLink } from '../components/CatchUpLink'
import { RefreshIcon } from '../components/Icons'
import { ProgressSegments } from '../components/charts/Bars'
import { IssueStories } from '../components/IssueStories'
import { useRegenerate } from '../components/useRegenerate'
import { BigNumber, Button, ErrorNote, LinkButton, Loading, PageHeader, SectionTitle } from '../components/ui'
import { londonToday, minutesLine, weekdayDayMonth } from '../lib/format'
import { visibleCount, withStory } from '../lib/issue'
import { useJobs } from '../lib/jobsContext'
import { useApi } from '../lib/useApi'
import { DESK_QUERY, useMedia } from '../lib/useMedia'
import { Overview } from './Overview'

/** Today on a phone; the Overview on 900px and wider. */
export function Today() {
  const desk = useMedia(DESK_QUERY)
  return desk ? <Overview /> : <PhoneToday />
}

function PhoneToday() {
  const today = londonToday()
  const summary = useApi('summary', (signal) => api.summary(signal))
  const reading = useApi('reading:14', (signal) => api.reading(14, signal))
  const { entries } = useJobs()
  const adding = Object.values(entries).filter(
    (e) => e.when === 'today' && (e.phase === 'starting' || e.phase === 'pending'),
  ).length

  const { mutate, reload } = summary
  const refresh = useCallback(() => {
    reload()
    reading.reload()
  }, [reload, reading])
  const onStoryChange = useCallback(
    (card: StoryCard) => mutate((s) => (s && s.today ? { ...s, today: withStory(s.today, card) } : s)),
    [mutate],
  )

  const data = summary.data
  const issue = data?.today ?? null
  const regen = useRegenerate(issue, refresh)
  const todayMinutes = reading.data?.days.find((d) => d.date === today)?.minutes

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Today"
        subtitle={weekdayDayMonth(issue?.date ?? today)}
        action={
          <Button
            variant="ghost"
            onClick={refresh}
            busy={summary.loading && Boolean(data)}
            aria-label="Refresh"
            className="size-11 rounded-full px-0!"
          >
            {!(summary.loading && data) && <RefreshIcon className="size-5" />}
          </Button>
        }
      />

      {summary.error && <ErrorNote onRetry={refresh}>{summary.error.message}</ErrorNote>}
      {!data && summary.loading && <Loading />}

      {data && (
        <>
          <NoDeviceYet seenAt={data.kindle_seen_at} />
          <StreakCard streak={data.streak_detail} days={reading.data?.days} today={today} weekRead={data.week_read} />

          <section aria-label="Today's paper" className="flex flex-col gap-3.5 rounded-2xl border border-line bg-card p-[18px]">
            <div className="flex items-center justify-between gap-2">
              <SectionTitle>Today’s paper</SectionTitle>
              <KindlePill issue={issue} seenAt={data.kindle_seen_at} />
            </div>
            {issue ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <BigNumber className="text-[40px]">
                    {issue.read_count} of {visibleCount(issue)}
                  </BigNumber>
                  <span className="text-sm text-muted">{minutesLine(todayMinutes)}</span>
                </div>
                <ProgressSegments read={issue.read_count} total={visibleCount(issue)} />
                <IssueBadges issue={issue} />
                <CatchUpLink count={data.catch_up_today} today={today} />
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="font-display text-[28px] leading-tight font-black">No paper yet</span>
                <span className="text-sm text-muted">
                  The daily run starts at 05:30. If it has not happened yet or did not work, you can make today’s
                  paper now.
                </span>
              </div>
            )}
            <div className="flex gap-2.5">
              <LinkButton to="/find" variant="primary" className="min-h-[46px] flex-1">
                Add a story
              </LinkButton>
              <Button onClick={regen.start} busy={regen.running} className="min-h-[46px] flex-1">
                {issue ? 'Make it again' : 'Make it now'}
              </Button>
            </div>
            {regen.status}
            {adding > 0 && (
              <p className="text-[13px] text-muted">
                {adding === 1 ? 'An article is' : `${adding} articles are`} being rewritten and checked.
              </p>
            )}
          </section>

          {issue && (
            <section aria-label="Stories" className="flex flex-col gap-2.5">
              <SectionTitle className="mt-1">Stories</SectionTitle>
              <IssueStories issue={issue} onStoryChange={onStoryChange} />
              <p className="text-xs text-muted">
                Hiding takes a story off the Kindle at its next check, as long as it has not been opened.
              </p>
            </section>
          )}

          <AiRunRow run={data.last_run_cost} today={today} />
          {regen.dialog}
        </>
      )}
    </div>
  )
}
