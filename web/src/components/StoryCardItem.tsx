import { Link } from 'react-router-dom'
import type { StoryCard, StoryStats } from '../api/types'
import { cx } from '../lib/cx'
import { storyStatus, type StoryStatusKind } from '../lib/format'
import { EyeIcon, EyeOffIcon } from './Icons'
import { Badge, Spinner, TopicChip } from './ui'

const PILL: Record<StoryStatusKind, string> = {
  read: 'bg-accent-soft text-accent',
  opened: 'bg-warm-soft text-warm',
  none: 'bg-chip text-muted',
}

/** "Read to the end · 1 min 50 s", "Opened · 20 s" or "Not opened yet". */
export function StatusPill({ stats, short }: { stats: StoryStats; short?: boolean }) {
  const s = storyStatus(stats, short)
  return (
    <span className={cx('inline-flex rounded-full px-[9px] py-1 text-xs leading-none font-bold', PILL[s.kind])}>
      {s.label}
    </span>
  )
}

export function StoryCardItem({
  story,
  onToggleHidden,
  busy,
}: {
  story: StoryCard
  /** Omit to leave out the hide/unhide control (e.g. a story added for tomorrow). */
  onToggleHidden?: (story: StoryCard) => void
  busy?: boolean
}) {
  return (
    <article
      className={cx(
        'flex items-center gap-2 rounded-[14px] border bg-card py-3.5 pr-2 pl-4',
        story.hidden ? 'border-dashed border-line opacity-80' : 'border-line',
      )}
    >
      <Link to={`/story/${story.id}`} className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg">
        <TopicChip topic={story.topic} />
        <span className={cx('text-[15px] leading-[1.3] font-semibold', story.hidden && 'line-through decoration-muted')}>
          {story.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill stats={story.stats} />
          {story.hidden && <Badge tone="amber">Hidden</Badge>}
          {story.added_by_parent && <Badge>Added by you</Badge>}
          {story.reused && <Badge title="Reused from an earlier issue">From an earlier day</Badge>}
        </span>
      </Link>
      {onToggleHidden && (
        <button
          type="button"
          onClick={() => onToggleHidden(story)}
          disabled={busy}
          aria-label={`${story.hidden ? 'Unhide' : 'Hide'} "${story.title}"`}
          title={story.hidden ? 'Unhide' : 'Hide'}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-chip hover:text-ink disabled:opacity-60"
        >
          {busy ? <Spinner /> : story.hidden ? <EyeIcon className="size-5" /> : <EyeOffIcon className="size-5" />}
        </button>
      )}
    </article>
  )
}
