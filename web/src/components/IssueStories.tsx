import type { IssueView, StoryCard } from '../api/types'
import { timeOf } from '../lib/format'
import { useHideToggle } from '../lib/useHideToggle'
import { StoryCardItem } from './StoryCardItem'
import { ErrorNote } from './ui'

export function DownloadedBy({ issue }: { issue: IssueView }) {
  if (issue.downloaded_by.length === 0) return <p className="text-sm text-muted">Not on the Kindle yet.</p>
  return (
    <ul className="flex flex-col gap-1 text-sm text-muted">
      {issue.downloaded_by.map((d) => (
        <li key={`${d.device}-${d.version}-${d.received_at}`}>
          On the Kindle since {timeOf(d.received_at)} · device {d.device}
          {d.version !== issue.version && `, version ${d.version}`}
        </li>
      ))}
    </ul>
  )
}


/** The cards of one issue, with hide and unhide wired up. */
export function IssueStories({
  issue,
  onStoryChange,
}: {
  issue: IssueView
  onStoryChange: (card: StoryCard) => void
}) {
  const { busyId, error, toggle } = useHideToggle(onStoryChange)
  const ordered = [...issue.stories].sort((a, b) => a.position - b.position)
  return (
    <div className="flex flex-col gap-2.5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {ordered.map((s) => (
        <StoryCardItem key={s.id} story={s} busy={busyId === s.id} onToggleHidden={(st) => void toggle(st)} />
      ))}
    </div>
  )
}
