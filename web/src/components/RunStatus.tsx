import type { RunView } from '../api/types'
import { clockTime, shortDate } from '../lib/format'
import { Badge } from './ui'

function tone(status: string): 'green' | 'rose' | 'blue' | 'amber' | 'neutral' {
  const s = status.toLowerCase()
  if (/(ok|success|created|done|exists)/.test(s)) return 'green'
  if (/(fail|error)/.test(s)) return 'rose'
  if (/(running|started|pending)/.test(s)) return 'blue'
  if (/(fallback|partial|warn)/.test(s)) return 'amber'
  return 'neutral'
}

function sentenceCase(s: string): string {
  const t = s.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** One run of the daily job. With no `title`, the run's date is the title. */
export function RunStatus({ run, title }: { run: RunView; title?: string }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{title ?? shortDate(run.date)}</div>
        <Badge tone={tone(run.status)}>{sentenceCase(run.status)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">
        {title && `For ${shortDate(run.date)}. `}
        Started {clockTime(run.started_at)}
        {run.finished_at ? `, finished ${clockTime(run.finished_at)}` : ', still running'}.
      </p>
      {run.detail.length > 0 && (
        <details className="group mt-2 text-sm">
          <summary className="cursor-pointer py-1 text-muted select-none hover:text-ink">
            Details ({run.detail.length})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {run.detail.map((d, i) => (
              <li key={i} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
