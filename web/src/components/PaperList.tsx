import { useState } from 'react'
import { api } from '../api/endpoints'
import type { IssueView, StoryCard } from '../api/types'
import { addDaysIso, londonToday, weekdayDayMonthShort } from '../lib/format'
import { readLine } from '../lib/issue'
import { useApi } from '../lib/useApi'
import { IssueStories } from './IssueStories'
import { Button, ErrorNote, Eyebrow, Spinner } from './ui'

/** Papers listed at first (today's and the two before it), and how many each "Show earlier days" adds. */
const FIRST_DAYS = 3
const MORE_DAYS = 3

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === addDaysIso(today, -1)) return 'Yesterday'
  return weekdayDayMonthShort(date)
}

/** A hide or unhide made on the story beside the list shows in the list at once. */
function withHidden(issue: IssueView, changed: StoryCard | undefined): IssueView {
  if (!changed || !issue.stories.some((s) => s.id === changed.id && s.hidden !== changed.hidden)) return issue
  const stories = issue.stories.map((s) => (s.id === changed.id ? { ...s, hidden: changed.hidden } : s))
  // "N of M read" counts the stories he can see.
  return { ...issue, stories, read_count: stories.filter((s) => !s.hidden && s.stats.reached_end).length }
}

function PaperDay({ date, today, currentId, changed }: { date: string; today: string; currentId: number; changed?: StoryCard }) {
  const issue = useApi(`issue:${date}`, (signal) => api.issue(date, signal))
  const label = dayLabel(date, today)
  const data = issue.data && withHidden(issue.data, changed)
  return (
    <section aria-label={label} className="flex flex-col gap-1 border-t border-line px-2 pt-3 pb-2 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2 px-2">
        <Eyebrow>{label}</Eyebrow>
        {data && <span className="text-xs text-muted">{readLine(data)}</span>}
      </div>
      {issue.error && !data && <ErrorNote onRetry={issue.reload}>{issue.error.message}</ErrorNote>}
      {!data && !issue.error && (
        <div role="status" className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
          <Spinner />
          Loading
        </div>
      )}
      {data && <IssueStories issue={data} variant="rows" currentId={currentId} />}
    </section>
  )
}

/**
 * The list beside the open story on a wide screen: today's stories, then earlier
 * days, in one column. The open story's own day is always in it, however old.
 */
export function PaperList({ currentId, currentDate, changed }: { currentId: number; currentDate?: string; changed?: StoryCard }) {
  const issues = useApi('issues:30', (signal) => api.issues(30, signal))
  const [count, setCount] = useState(FIRST_DAYS)
  const today = londonToday()
  const all = issues.data?.map((i) => i.date) ?? []
  const dates = all.slice(0, count)
  if (currentDate && !dates.includes(currentDate)) dates.push(currentDate)
  dates.sort((a, b) => (a < b ? 1 : -1))

  return (
    <nav
      aria-label="Stories"
      data-scroll-pane
      className="sticky top-7 flex max-h-[calc(100dvh-56px)] flex-col overflow-y-auto rounded-2xl border border-line bg-card"
    >
      {issues.error && !issues.data && (
        <div className="p-2">
          <ErrorNote onRetry={issues.reload}>{issues.error.message}</ErrorNote>
        </div>
      )}
      {dates.map((d) => (
        <PaperDay key={d} date={d} today={today} currentId={currentId} changed={changed} />
      ))}
      {issues.data && dates.length === 0 && <p className="m-0 p-4 text-sm text-muted">No papers yet.</p>}
      {count < all.length && (
        <div className="border-t border-line p-2">
          <Button variant="ghost" className="w-full" onClick={() => setCount((c) => c + MORE_DAYS)}>
            Show earlier days
          </Button>
        </div>
      )}
    </nav>
  )
}
