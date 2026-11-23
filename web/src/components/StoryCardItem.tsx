import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { StoryCard, StoryStats } from '../api/types'
import { cx } from '../lib/cx'
import { useOrigin } from '../lib/origin'
import { storyStatus, type StoryStatusKind } from '../lib/format'
import { EyeIcon, EyeOffIcon } from './Icons'
import { Badge, Spinner, TopicChip } from './ui'

const PILL: Record<StoryStatusKind, string> = {
  read: 'bg-accent-soft text-accent',
  too_fast: 'bg-warm-soft text-warm',
  opened: 'bg-warm-soft text-warm',
  none: 'bg-chip text-muted',
}

/** "Read to the end · 1 min 50 s", "Read too fast · 9 s", "Opened · 20 s" or "Not opened yet". */
export function StatusPill({ stats, short, paperDate }: { stats: StoryStats; short?: boolean; paperDate?: string }) {
  const s = storyStatus(stats, short, paperDate)
  return (
    <span className={cx('inline-flex rounded-full px-[9px] py-1 text-xs leading-none font-bold', PILL[s.kind])}>
      {s.label}
    </span>
  )
}

/**
 * One story in the list beside an open story: topic, reading time, title, status
 * and a Hidden badge. Choosing one moves sideways, like the story page's arrows:
 * it replaces the open story and keeps where the page was opened from.
 */
export function StoryRowItem({ story, current }: { story: StoryCard; current?: boolean }) {
  const { state } = useLocation()
  const link = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    // Keep the open story in sight in the list (arrow keys can move past its edge).
    // Only the list scrolls for this, never the page.
    const el = link.current
    const pane = el?.closest<HTMLElement>('[data-scroll-pane]')
    if (!current || !el || !pane) return
    const row = el.getBoundingClientRect()
    const box = pane.getBoundingClientRect()
    if (row.top < box.top) pane.scrollTop -= box.top - row.top + 8
    else if (row.bottom > box.bottom) pane.scrollTop += row.bottom - box.bottom + 8
  }, [current])
  return (
    <Link
      ref={link}
      to={`/story/${story.id}`}
      state={state}
      replace
      aria-current={current ? 'page' : undefined}
      className={cx(
        'flex flex-col gap-1.5 rounded-[10px] px-2 py-2.5',
        current ? 'bg-bg shadow-[inset_3px_0_0_var(--accent)]' : 'hover:bg-chip',
        story.hidden && 'opacity-80',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <TopicChip topic={story.topic} />
        <span className="shrink-0 text-xs text-muted tabular-nums">{story.minutes} min</span>
      </span>
      <span className={cx('text-sm leading-[1.3] font-semibold', story.hidden && 'line-through decoration-muted')}>
        {story.title}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusPill stats={story.stats} short paperDate={story.date} />
        {story.hidden && <Badge tone="amber">Hidden</Badge>}
      </span>
    </Link>
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
  const origin = useOrigin()
  return (
    <article
      className={cx(
        'flex items-center gap-2 rounded-[14px] border bg-card py-3.5 pr-2 pl-4',
        story.hidden ? 'border-dashed border-line opacity-80' : 'border-line',
      )}
    >
      <Link to={`/story/${story.id}`} state={origin} className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg">
        <TopicChip topic={story.topic} />
        <span className={cx('text-[15px] leading-[1.3] font-semibold', story.hidden && 'line-through decoration-muted')}>
          {story.title}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill stats={story.stats} paperDate={story.date} />
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
