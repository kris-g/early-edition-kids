import { api } from '../api/endpoints'
import { runsOn, uptime } from '../lib/format'
import { sportFetchRows, type FetchRow } from '../lib/sport'
import { useApi } from '../lib/useApi'
import { Card, SectionTitle } from './ui'

/** The server every child's paper comes from: its version, where it runs, how long it has been up, and the Sport fetch. */
export function AboutServer() {
  const about = useApi('about', (signal) => api.about(signal))
  const rows: FetchRow[] = about.data
    ? [
        { label: 'Version', value: about.data.version },
        { label: 'Runs on', value: runsOn(about.data) },
        { label: 'Running for', value: uptime(about.data.uptime_seconds) },
        ...(about.data.sport ? sportFetchRows(about.data.sport) : []),
      ]
    : []
  return (
    <>
      <SectionTitle>About this server</SectionTitle>
      <Card label="About this server" className="p-0!">
        {about.data ? (
          <dl className="m-0">
            {rows.map(({ label, value, note }, i) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-4 px-[18px] py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <dt className="shrink-0 text-sm text-muted">{label}</dt>
                <dd className="m-0 min-w-0 text-right text-sm font-semibold break-words">
                  {value}
                  {note && <span className="mt-0.5 block text-xs font-normal text-muted">{note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 px-[18px] py-3.5 text-sm text-muted">
            {about.error ? 'The server didn’t say. It may be an older version.' : 'Asking the server…'}
          </p>
        )}
      </Card>
    </>
  )
}
