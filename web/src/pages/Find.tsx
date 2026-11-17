import { useState } from 'react'
import { api } from '../api/endpoints'
import type { AddWhen } from '../api/routes'
import type { ArticleHit } from '../api/types'
import { CloseIcon, InfoIcon, SearchIcon } from '../components/Icons'
import { StoryCardItem } from '../components/StoryCardItem'
import { Badge, Button, Card, ErrorNote, Loading, PageHeader, SectionTitle, Spinner } from '../components/ui'
import { hostOf, londonToday, looksLikeUrl, shortDate } from '../lib/format'
import { useJobs, type JobEntry } from '../lib/jobsContext'
import { readFlag, writeFlag } from '../lib/storage'
import { useApi, useDebounced } from '../lib/useApi'

const INTRO_KEY = 'early-edition.find.introDismissed'

function linkHit(url: string): ArticleHit {
  return {
    url,
    source_name: hostOf(url),
    title: url,
    summary: 'A link you pasted. It is fetched, rewritten and checked like any other article.',
    published_at: null,
    already_used: false,
  }
}

export function Find() {
  const [query, setQuery] = useState('')
  const [showIntro, setShowIntro] = useState(() => !readFlag(INTRO_KEY))
  const q = useDebounced(query.trim(), 350)
  const isUrl = looksLikeUrl(q)
  const results = useApi(isUrl ? null : `search:${q}`, (signal) => api.search(q, signal))
  const { entries, add, dismiss } = useJobs()

  const hits: ArticleHit[] = isUrl ? [linkHit(q)] : (results.data ?? [])
  const shownUrls = new Set(hits.map((h) => h.url))
  const others = Object.values(entries).filter((e) => !shownUrls.has(e.url))

  return (
    <div>
      <PageHeader title="Add a story" subtitle="Search the news or paste a link, for today’s paper or tomorrow’s" />

      {showIntro && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-line bg-chip p-4 text-sm text-ink">
          <InfoIcon className="mt-0.5 size-5 shrink-0" />
          <p className="flex-1">
            Every article you add is rewritten for the reader’s age and safety-checked first, just like the daily picks. If it does
            not pass, it is not added and you will see why.
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            className="-m-2.5 flex size-11 items-center justify-center rounded-full hover:bg-card"
            onClick={() => {
              writeFlag(INTRO_KEY, true)
              setShowIntro(false)
            }}
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      )}

      <label htmlFor="find" className="sr-only">
        Search the archive or paste a link
      </label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted" />
        <input
          id="find"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Search, or paste a link"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="block min-h-12 w-full rounded-xl border border-line bg-card pr-4 pl-11 text-base text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        Searches everything the feeds brought in over the last 30 days. Paste any article link to add that instead.
      </p>

      {others.length > 0 && (
        <>
          <SectionTitle className="mt-7 mb-3">Your additions</SectionTitle>
          <div className="space-y-3">
            {others.map((e) => (
              <Card key={e.url}>
                <div className="truncate text-sm font-medium">{e.job?.story?.title ?? hostOf(e.url)}</div>
                <div className="truncate text-xs text-muted">{e.url}</div>
                <JobStatus entry={e} onRetry={() => add(e.url, e.when)} onDismiss={() => dismiss(e.url)} />
              </Card>
            ))}
          </div>
        </>
      )}

      <SectionTitle className="mt-7 mb-3">{isUrl ? 'Link' : q ? 'Results' : 'Newest'}</SectionTitle>
      {results.error && <ErrorNote onRetry={results.reload}>{results.error.message}</ErrorNote>}
      {!isUrl && !results.data && results.loading && <Loading label="Searching" />}
      {!isUrl && results.data && results.data.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">Nothing in the last 30 days matches “{q}”.</p>
      )}
      <div className="space-y-3">
        {hits.map((hit) => (
          <HitCard
            key={hit.url}
            hit={hit}
            entry={entries[hit.url]}
            onAdd={(when) => add(hit.url, when)}
            onDismiss={() => dismiss(hit.url)}
          />
        ))}
      </div>
    </div>
  )
}

function HitCard({
  hit,
  entry,
  onAdd,
  onDismiss,
}: {
  hit: ArticleHit
  entry: JobEntry | undefined
  onAdd: (when: AddWhen) => void
  onDismiss: () => void
}) {
  const working = entry?.phase === 'starting' || entry?.phase === 'pending'
  const finished = entry?.phase === 'done'
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className="font-semibold text-ink">{hit.source_name}</span>
        {hit.published_at && <span>{shortDate(londonToday(new Date(hit.published_at)))}</span>}
        {hit.already_used && (
          <Badge tone="amber" title="This article has already been in an issue">
            Already used
          </Badge>
        )}
      </div>
      <h3 className="mt-1.5 leading-snug font-semibold break-words">{hit.title}</h3>
      {hit.summary && (
        <p className="mt-1 line-clamp-3 text-sm text-muted">{hit.summary}</p>
      )}
      {!finished && !working && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button variant="primary" className="px-2!" disabled={working} onClick={() => onAdd('today')}>
            Add to today
          </Button>
          <Button className="px-2!" disabled={working} onClick={() => onAdd('tomorrow')}>
            Add for tomorrow
          </Button>
        </div>
      )}
      {entry && <JobStatus entry={entry} onRetry={() => onAdd(entry.when)} onDismiss={onDismiss} />}
    </Card>
  )
}

function JobStatus({ entry, onRetry, onDismiss }: { entry: JobEntry; onRetry: () => void; onDismiss: () => void }) {
  const target = entry.when === 'today' ? 'today’s issue' : 'tomorrow’s issue'

  if (entry.phase === 'starting' || entry.phase === 'pending') {
    return (
      <div role="status" className="mt-3 flex items-start gap-3 rounded-xl bg-chip p-3 text-sm">
        <Spinner className="mt-0.5 text-accent" />
        <div>
          <div className="font-medium">Rewriting and checking for {target}</div>
          <div className="text-muted">This usually takes under a minute.</div>
        </div>
      </div>
    )
  }

  if (entry.phase === 'done') {
    const story = entry.job?.story
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm font-medium text-accent">
          {entry.when === 'today' ? 'Added to today’s issue.' : 'Saved for tomorrow’s issue.'}
        </p>
        {story && <StoryCardItem story={story} />}
      </div>
    )
  }

  if (entry.phase === 'failed') {
    const reasons = entry.job?.reasons ?? []
    return (
      <div className="mt-3 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-ink">
        <div className="font-medium">Not added. It did not pass the checks:</div>
        {reasons.length > 0 ? (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">No reason was given.</p>
        )}
        <Button variant="ghost" className="mt-2 -ml-2" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <ErrorNote onRetry={onRetry}>{entry.error ?? 'Something went wrong.'}</ErrorNote>
    </div>
  )
}
