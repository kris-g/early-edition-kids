import { api } from '../api/endpoints'
import { RunStatus } from '../components/RunStatus'
import { Card, ErrorNote, Loading, PageHeader } from '../components/ui'
import { useApi } from '../lib/useApi'

export function Runs() {
  const runs = useApi('runs', (signal) => api.runs(14, signal))
  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Recent runs" subtitle="The daily job that makes each paper" />
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
