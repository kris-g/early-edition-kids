import { api } from '../api/endpoints'
import { AboutServer } from '../components/AboutServer'
import { RunStatus } from '../components/RunStatus'
import { Card, ErrorNote, Loading, PageHeader, SectionTitle } from '../components/ui'
import { useApi } from '../lib/useApi'

/** The server: what it is and where it runs, then the daily runs that made the recent papers. */
export function Runs() {
  const runs = useApi('runs', (signal) => api.runs(14, signal))
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Server" subtitle="What makes the paper each morning" />
      <AboutServer />
      <SectionTitle className="mt-4">Recent runs</SectionTitle>
      {runs.error && <ErrorNote onRetry={runs.reload}>{runs.error.message}</ErrorNote>}
      {!runs.data && runs.loading && <Loading />}
      {runs.data && runs.data.length === 0 && <p className="text-sm text-muted">No runs yet.</p>}
      {runs.data?.map((r) => (
        <Card key={r.started_at}>
          <RunStatus run={r} />
        </Card>
      ))}
    </div>
  )
}
