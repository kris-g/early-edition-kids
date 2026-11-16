import type { IssueView, StoryCard } from '../api/types'
import { timeOf } from '../lib/format'
import { useHideToggle } from '../lib/useHideToggle'
import { StoryCardItem, StoryRowItem } from './StoryCardItem'
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


const unchanged = () => {}

/**
 * The stories of one issue. As cards (the default), with hide and unhide wired
 * up; as `rows`, the compact list beside an open story, where `currentId` is
 * the one that is open.
 */
export function IssueStories({
  issue,
  onStoryChange = unchanged,
  variant = 'cards',
  currentId,
}: {
  issue: IssueView
  onStoryChange?: (card: StoryCard) => void
  variant?: 'cards' | 'rows'
  currentId?: number
}) {
  const { busyId, error, toggle } = useHideToggle(onStoryChange)
  const ordered = [...issue.stories].sort((a, b) => a.position - b.position)
  if (variant === 'rows') {
    return (
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {ordered.map((s) => (
          <li key={s.id}>
            <StoryRowItem story={s} current={s.id === currentId} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="flex flex-col gap-2.5">
      {error && <ErrorNote>{error}</ErrorNote>}
      {ordered.map((s) => (
        <StoryCardItem key={s.id} story={s} busy={busyId === s.id} onToggleHidden={(st) => void toggle(st)} />
      ))}
    </div>
  )
}
