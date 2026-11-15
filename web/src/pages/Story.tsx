import { useCallback } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { StoryCard } from '../api/types'
import { ChevronLeft, ChevronRight, ExternalIcon, EyeIcon, EyeOffIcon } from '../components/Icons'
import { BackLink } from '../components/BackLink'
import { KindlePage } from '../components/KindlePage'
import { StatusPill } from '../components/StoryCardItem'
import { Badge, Button, Card, ErrorNote, LinkButton, Loading, SectionTitle, TopicChip } from '../components/ui'
import { ENGAGED_EXPLAINER, londonToday, longDate, statsSentence } from '../lib/format'
import { dayPath } from '../lib/day'
import { useApi } from '../lib/useApi'
import { useHideToggle } from '../lib/useHideToggle'

export function Story() {
  const { id: idParam } = useParams()
  const location = useLocation()
  const id = Number(idParam)
  const valid = Number.isInteger(id) && id > 0
  const story = useApi(valid ? `story:${id}` : null, (signal) => api.story(id, signal))
  const { mutate } = story
  const onUpdated = useCallback((card: StoryCard) => mutate((s) => (s ? { ...s, ...card } : s)), [mutate])
  const hide = useHideToggle(onUpdated)

  if (!valid) return <ErrorNote>That story link is not right.</ErrorNote>
  if (story.error && !story.data) return <ErrorNote onRetry={story.reload}>{story.error.message}</ErrorNote>
  const s = story.data
  if (!s) return <Loading />

  const isToday = s.date === londonToday()
  // Opened directly (no "from"): back to its paper.
  const fallback = isToday ? { to: '/', label: 'Today' } : { to: dayPath(s.date, 'paper'), label: longDate(s.date) }

  return (
    <div className="flex flex-col">
      <BackLink fallback={fallback} />

      <div className="mt-1 mb-4 flex flex-wrap items-center gap-2">
        <TopicChip topic={s.topic} />
        <StatusPill stats={s.stats} paperDate={s.date} />
        {s.hidden && <Badge tone="amber">Hidden</Badge>}
        {s.added_by_parent && <Badge tone="violet">Added by you</Badge>}
        {s.reused && <Badge>From an earlier day</Badge>}
        <span className="text-xs text-muted">
          Story {s.position}
          {s.version > 1 && `, version ${s.version}`} · {s.word_count} words
        </span>
      </div>

      <KindlePage story={s} />

      <SectionTitle className="mt-7 mb-3">Reading</SectionTitle>
      <Card>
        <p className="text-sm">{statsSentence(s.stats)}</p>
        {s.stats.engaged && <p className="mt-1 text-sm text-accent">Engaged.</p>}
        <p className="mt-2 text-xs text-muted">{ENGAGED_EXPLAINER}</p>
      </Card>

      <SectionTitle className="mt-7 mb-3">Source</SectionTitle>
      <Card>
        <div className="text-sm">
          <span className="font-semibold">{s.source_name}</span>
          {s.source_title && <span className="text-muted">: {s.source_title}</span>}
        </div>
        <a
          href={s.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold hover:bg-chip"
        >
          Open the original article
          <ExternalIcon className="size-4" />
        </a>
      </Card>

      <div className="mt-6 space-y-2">
        {hide.error && <ErrorNote>{hide.error}</ErrorNote>}
        <Button className="w-full" busy={hide.busyId === s.id} onClick={() => void hide.toggle(s)}>
          {hide.busyId !== s.id && (s.hidden ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />)}
          {s.hidden ? 'Unhide this story' : 'Hide this story'}
        </Button>
        {!s.hidden && (
          <p className="text-center text-xs text-muted">
            Hiding takes it off the Kindle at its next check, as long as he has not opened it.
          </p>
        )}
      </div>

      <nav aria-label="Stories in this issue" className="mt-6 grid grid-cols-2 gap-3">
        {s.prev_id ? (
          <LinkButton to={`/story/${s.prev_id}`} state={location.state} replace>
            <ChevronLeft className="size-4" />
            Previous
          </LinkButton>
        ) : (
          <span />
        )}
        {s.next_id ? (
          <LinkButton to={`/story/${s.next_id}`} state={location.state} replace>
            Next
            <ChevronRight className="size-4" />
          </LinkButton>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}
