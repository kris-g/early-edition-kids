import { api } from '../api/endpoints'
import { runsOn, uptime } from '../lib/format'
import { useApi } from '../lib/useApi'
import { Card, SectionTitle } from './ui'

/** The server every child's paper comes from: its version, where it runs and how long it has been up. */
export function AboutServer() {
  const about = useApi('about', (signal) => api.about(signal))
  const rows: [string, string][] = about.data
    ? [
        ['Version', about.data.version],
        ['Runs on', runsOn(about.data)],
        ['Running for', uptime(about.data.uptime_seconds)],
      ]
    : []
  return (
    <>
      <SectionTitle className="mt-2">About this server</SectionTitle>
      <Card label="About this server" className="p-0!">
        {about.data ? (
          <dl className="m-0">
            {rows.map(([label, value], i) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-4 px-[18px] py-3.5 ${i > 0 ? 'border-t border-line' : ''}`}
              >
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="m-0 text-right text-sm font-semibold break-words">{value}</dd>
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
