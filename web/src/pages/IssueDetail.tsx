import { useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/endpoints'
import type { StoryCard } from '../api/types'
import { ChevronLeft } from '../components/Icons'
import { DownloadedBy, IssueStories } from '../components/IssueStories'
import { IssueBadges } from '../components/home'
import { Card, ErrorNote, Loading, PageHeader } from '../components/ui'
import { longDate } from '../lib/format'
import { readLine, withStory } from '../lib/issue'
import { useApi } from '../lib/useApi'

export function IssueDetail() {
  const { date = '' } = useParams()
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const issue = useApi(valid ? `issue:${date}` : null, (signal) => api.issue(date, signal))
  const { mutate } = issue
  const onStoryChange = useCallback((card: StoryCard) => mutate((i) => (i ? withStory(i, card) : i)), [mutate])

  return (
    <div>
      <Link
        to="/issues"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm text-muted hover:text-ink"
      >
        <ChevronLeft className="size-4" />
        Back issues
      </Link>
      {!valid && <ErrorNote>That date is not right.</ErrorNote>}
      {valid && (
        <PageHeader title={longDate(date)} subtitle={issue.data ? readLine(issue.data) : undefined} />
      )}
      {issue.error && !issue.data && <ErrorNote onRetry={issue.reload}>{issue.error.message}</ErrorNote>}
      {!issue.data && issue.loading && <Loading />}
      {issue.data && (
        <>
          <Card className="mb-5 space-y-2">
            <DownloadedBy issue={issue.data} />
            <IssueBadges issue={issue.data} />
          </Card>
          <IssueStories issue={issue.data} onStoryChange={onStoryChange} />
        </>
      )}
    </div>
  )
}
