// Building blocks of the Today page (phone) and the Overview (desktop).
import { useId } from 'react'
import { Link } from 'react-router-dom'
import type { IssueView, ReadingDay, RunCost, Streak } from '../api/types'
import { cx } from '../lib/cx'
import { clockTime, dayMonthLong, money, plural, prettyModel } from '../lib/format'
import { thisWeek } from '../lib/stats'
import { dayTip } from '../lib/tips'
import { useRoving } from './tooltip/useRoving'
import { useTip } from './tooltip/useTip'
import { ChevronRight, FlameIcon, SparkleIcon } from './Icons'
import { Badge, BigNumber, Eyebrow } from './ui'

/**
 * "Kindle synced 19:22" from the Kindle's last check-in, so a parent can tell
 * whether the latest reading has arrived; "On the Kindle 06:42" (the first
 * download of the current version) when there is no later check-in to show.
 */
export function KindlePill({
  issue,
  seenAt,
  large,
}: {
  issue: IssueView | null
  seenAt?: string | null
  large?: boolean
}) {
  const first = issue?.downloaded_by[0]
  const cls = cx(
    'inline-flex items-center rounded-full font-bold whitespace-nowrap',
    large ? 'min-h-9 px-3.5 text-[13px]' : 'px-2.5 py-[5px] text-xs',
  )
  if (!issue) return null
  if (!first) return <span className={cx(cls, 'bg-chip text-muted')}>Not on the Kindle yet</span>
  const synced = seenAt && Date.parse(seenAt) >= Date.parse(first.received_at) ? seenAt : null
  return (
    <span className={cx(cls, 'bg-accent-soft text-accent')}>
      {synced ? `Kindle synced ${clockTime(synced)}` : `On the Kindle ${clockTime(first.received_at)}`}
    </span>
  )
}

export function StreakCard({
  streak,
  days,
  today,
  weekRead,
}: {
  streak: Streak
  days: ReadingDay[] | undefined
  today: string
  weekRead: number
}) {
  const readToday = (days?.find((d) => d.date === today)?.read ?? 0) > 0
  const week = days ? thisWeek(days, today) : []
  const id = useId()
  const tip = useTip()
  const roving = useRoving(7, week.findIndex((d) => d.isToday))
  return (
    <section aria-label="Reading streak" className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Eyebrow>Reading streak</Eyebrow>
          {streak.current > 0 ? (
            <div className="flex items-baseline gap-2">
              <BigNumber className="text-[60px]">{streak.current}</BigNumber>
              <span className="text-base font-semibold">{streak.current === 1 ? 'day' : 'days in a row'}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 py-1">
              <span className="font-display text-[28px] leading-tight font-black">No streak yet</span>
              <span className="text-[13px] text-muted">A streak starts on any day a story is read to the end.</span>
            </div>
          )}
          {streak.longest > 0 && (
            <span className="text-[13px] text-muted">Longest so far: {plural(streak.longest, 'day')}</span>
          )}
        </div>
        {readToday && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warm-soft px-2.5 py-1.5 text-xs font-bold text-warm">
            <FlameIcon className="size-3.5" />
            Read today
          </span>
        )}
      </div>
      {week.length > 0 && (
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="This week" data-roving>
          {week.map((d, i) => {
            return (
              <div
                key={d.date}
                role="img"
                {...tip(`${id}-${i}`, dayTip(d.day, today), {
                  tabIndex: roving.tabIndex(i),
                  onFocus: roving.onFocus(i),
                  onKeyDown: roving.onKeyDown,
                })}
                className="flex cursor-default flex-col items-center gap-1.5 rounded-lg"
              >
                <span aria-hidden="true" className="text-[11px] font-bold text-muted">
                  {d.name}
                </span>
                <span
                  aria-hidden="true"
                  className={cx(
                    'box-border flex aspect-square w-full max-w-[38px] items-center justify-center rounded-full border-2 text-sm font-bold',
                    d.future
                      ? 'border-dashed border-line text-muted'
                      : (d.read ?? 0) > 0
                        ? 'border-accent bg-accent text-on-accent'
                        : 'border-line text-muted',
                    d.isToday && 'shadow-[0_0_0_3px_var(--accent-soft)]',
                  )}
                >
                  {d.future ? '' : d.read}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <Link
        to="/reading"
        className="flex min-h-11 items-center justify-between border-t border-line pt-2.5 text-sm font-semibold text-accent"
      >
        {weekRead > 0 ? `${plural(weekRead, 'story', 'stories')} this week` : 'No stories yet this week'}
        <ChevronRight className="size-[18px]" />
      </Link>
    </section>
  )
}

/** "Written at 05:31 by Claude Opus 5.5 · 61 seconds · $0.46 · 1 story sent back" */
export function AiRunRow({ run, today }: { run: RunCost | null; today: string }) {
  const failed = run ? /fail|error/i.test(run.status) : false
  const models = run ? [...new Set(run.models)].map(prettyModel) : []
  const title = !run
    ? 'AI: models, usage and cost'
    : failed
      ? `The run at ${clockTime(run.started_at)} had a problem`
      : `Written at ${clockTime(run.started_at)}${models.length ? ` by ${models.join(' and ')}` : ''}`
  const parts: string[] = []
  if (run) {
    if (run.date !== today) parts.push(dayMonthLong(run.date))
    if (run.seconds !== null) parts.push(`${Math.round(run.seconds)} seconds`)
    parts.push(money(run.cost_usd))
    parts.push(
      run.sent_back > 0
        ? `${plural(run.sent_back, 'story', 'stories')} sent back by the checker`
        : 'nothing sent back by the checker',
    )
  }
  return (
    <Link to="/ai" className="flex min-h-11 items-center gap-3 rounded-[14px] bg-chip px-4 py-3.5">
      <SparkleIcon className={cx('size-[22px] shrink-0', failed ? 'text-warm' : 'text-accent')} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        {parts.length > 0 && <span className="text-xs text-muted">{parts.join(' · ')}</span>}
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-muted" />
    </Link>
  )
}

export function IssueBadges({ issue }: { issue: IssueView }) {
  if (!issue.fallback && issue.version <= 1) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {issue.fallback && (
        <Badge tone="amber" title="The daily run failed, so this paper was made from unopened stories from the last week.">
          Catch-up paper
        </Badge>
      )}
      {issue.version > 1 && <Badge>Version {issue.version}</Badge>}
    </div>
  )
}
