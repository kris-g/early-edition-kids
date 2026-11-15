import { Link } from 'react-router-dom'
import { api } from '../api/endpoints'
import { ChevronRight } from '../components/Icons'
import { Badge, ErrorNote, Loading, PageHeader } from '../components/ui'
import { londonToday, longDate } from '../lib/format'
import { dayPath } from '../lib/day'
import { useApi } from '../lib/useApi'

export function Issues() {
  const issues = useApi('issues', (signal) => api.issues(30, signal))
  const today = londonToday()

  return (
    <div>
      <PageHeader title="Back issues" subtitle="The last 30 issues, newest first" />
      {issues.error && <ErrorNote onRetry={issues.reload}>{issues.error.message}</ErrorNote>}
      {!issues.data && issues.loading && <Loading />}
      {issues.data && issues.data.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">No issues yet.</p>
      )}
      {issues.data && issues.data.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {issues.data.map((i) => (
            <li key={`${i.date}-${i.version}`}>
              <Link
                to={dayPath(i.date, 'paper')}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition hover:bg-chip"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.date === today ? 'Today' : longDate(i.date)}</span>
                    {i.fallback && <Badge tone="amber">Catch-up</Badge>}
                    {i.version > 1 && <Badge>Version {i.version}</Badge>}
                  </div>
                  <div className="mt-0.5 text-sm text-muted">
                    {i.read_count} of {i.story_count} read
                  </div>
                </div>
                <ReadDots read={i.read_count} total={i.story_count} />
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A quiet row of dots, filled for each story read. Counts only, no judgement. */
function ReadDots({ read, total }: { read: number; total: number }) {
  const n = Math.min(total, 10)
  return (
    <div className="hidden shrink-0 gap-1 min-[400px]:flex" aria-hidden="true">
      {Array.from({ length: n }, (_, k) => (
        <span
          key={k}
          className={
            k < read
              ? 'size-2 rounded-full bg-accent'
              : 'size-2 rounded-full bg-line'
          }
        />
      ))}
    </div>
  )
}
