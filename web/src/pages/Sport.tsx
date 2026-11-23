import { useState } from 'react'
import { Link } from 'react-router-dom'
import { messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { SportPageUse, SportSettings, SportSettingsView, UnlockStatus, UnlockStory } from '../api/types'
import { Badge, Card, ErrorNote, Loading, PageHeader, SectionTitle, Segment, Spinner, Switch } from '../components/ui'
import { clockTime, duration, percent, plural } from '../lib/format'
import { sportPageName } from '../lib/sport'
import { useApi } from '../lib/useApi'

/** The choices offered; a value set in the config that isn't one of them still shows, as a percentage. */
type Choice = { value: number; label: string; name: string }
const READ_FIRST: Choice[] = [
  { value: 0, label: 'No', name: 'No' },
  { value: 0.25, label: '¼', name: 'A quarter' },
  { value: 0.5, label: '½', name: 'Half' },
  { value: 0.75, label: '¾', name: 'Three quarters' },
  { value: 1, label: 'All', name: 'All' },
]

/** "Half of today's 6 stories (3)", in words a parent reads at a glance. */
function readFirstLine(s: SportSettings, today: UnlockStatus | null): string {
  if (s.read_first <= 0) return 'Sport is open from the start of the day.'
  if (!today) return `Sport opens after reading ${percent(s.read_first)} of the day's stories.`
  return `Sport opens after reading ${today.needed} of today's ${plural(today.total, 'story', 'stories')}.`
}

function storyState(s: UnlockStory): { label: string; tone: 'green' | 'amber' | 'neutral' } {
  if (s.counts) return { label: 'Counts', tone: 'green' }
  if (s.rushed) return { label: `Too fast: ${duration(s.active_seconds)} of ${duration(s.min_seconds)}`, tone: 'amber' }
  if (s.active_seconds > 0) return { label: 'Not finished', tone: 'neutral' }
  return { label: 'Not read yet', tone: 'neutral' }
}

/** The Sport page's settings for this child, today's progress toward opening it, and time spent on it. */
export function Sport() {
  const view = useApi('sport-settings', (signal) => api.sportSettings(signal))
  const usage = useApi('sport-usage', (signal) => api.sportUsage(7, signal))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(patch: Partial<SportSettings>) {
    setBusy(true)
    setError(null)
    try {
      const updated: SportSettingsView = await api.putSportSettings(patch)
      view.mutate(() => updated)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const data = view.data
  const s = data?.settings
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sport" subtitle="The Premier League page, and what comes before it" />
      {view.error && <ErrorNote onRetry={view.reload}>{view.error.message}</ErrorNote>}
      {!data && view.loading && <Loading />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {s && (
        // On a wide screen the settings sit on the left and what they did on the right, as on the AI page.
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 desk:grid-cols-2 desk:items-start">
          <div className="flex flex-col gap-4">
            <Card label="Sport page">
              <div className="flex items-center gap-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <SectionTitle>Sport page</SectionTitle>
                  <span className="text-[13px] text-muted">
                    The table, the latest results and the next fixtures, updated each morning with the paper.
                  </span>
                </div>
                {busy && <Spinner className="text-muted" />}
                <Switch checked={s.enabled} label="Sport page for this child" disabled={busy} onClick={() => void change({ enabled: !s.enabled })} />
              </div>
            </Card>
            {s.enabled && (
              <>
                <Card label="Read first" className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <SectionTitle>Read the news first</SectionTitle>
                    <span className="text-[13px] text-muted">{readFirstLine(s, data.today)}</span>
                    {s.read_first > 0 && (
                      <span className="text-[13px] text-muted">
                        A story read too fast doesn’t count; how fast is too fast is set on the{' '}
                        <Link to="/reading" className="font-semibold text-accent hover:underline">
                          Reading
                        </Link>{' '}
                        page.
                      </span>
                    )}
                  </div>
                  <div role="group" aria-label="How much of the paper to read first" className="grid grid-cols-5 gap-1.5">
                    {READ_FIRST.map((c) => (
                      <Segment key={c.value} aria-label={c.name} pressed={s.read_first === c.value} disabled={busy} onClick={() => void change({ read_first: c.value })} className="text-base">
                        {c.label}
                      </Segment>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </div>
          {s.enabled && (
            <div className="flex flex-col gap-4">
              {data.today && <Today status={data.today} />}
              <ThisWeek usage={usage.data?.pages ?? null} seconds={usage.data?.seconds ?? 0} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Today({ status }: { status: UnlockStatus }) {
  const rushed = status.stories.filter((x) => x.rushed).length
  return (
    <Card label="Today" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <SectionTitle>Today</SectionTitle>
          <span className="text-[13px] text-muted">
            {status.unlocked
              ? `Sport opened${status.unlocked_at ? ` at ${clockTime(status.unlocked_at)}` : ''}.`
              : `${status.counted} of ${status.needed} read; Sport is still closed.`}
            {rushed > 0 && ` ${plural(rushed, 'story was', 'stories were')} read too fast to count.`}
          </span>
        </div>
        <Badge tone={status.unlocked ? 'green' : 'neutral'}>{status.unlocked ? 'Open' : 'Closed'}</Badge>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {status.stories.map((story) => {
          const st = storyState(story)
          return (
            <li key={story.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-line py-2.5 first:border-t-0">
              <span className="min-w-[12rem] flex-1 text-sm">{story.title}</span>
              <span className="whitespace-nowrap">
                <Badge tone={st.tone}>{st.label}</Badge>
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function ThisWeek({ usage, seconds }: { usage: SportPageUse[] | null; seconds: number }) {
  if (!usage) return null
  return (
    <Card label="Time on Sport" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <SectionTitle>Time on Sport</SectionTitle>
        <span className="text-[13px] text-muted">
          {seconds > 0 ? `${duration(seconds)} in the last 7 days.` : 'Not opened in the last 7 days.'}
        </span>
      </div>
      {usage.length > 0 && (
        <ul className="m-0 flex list-none flex-col p-0">
          {usage.slice(0, 6).map((u) => (
            <li key={`${u.page}:${u.match_id ?? ''}`} className="flex flex-col gap-0.5 border-t border-line py-2.5 text-sm first:border-t-0 desk:flex-row desk:items-baseline desk:justify-between desk:gap-3">
              <span>{sportPageName(u)}</span>
              <span className="shrink-0 text-[13px] text-muted tabular-nums">
                {duration(u.seconds)} · {plural(u.views, 'look')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
