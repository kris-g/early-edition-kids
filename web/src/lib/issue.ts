import type { IssueView, StoryCard } from '../api/types'

/** Stories he can see (hidden ones are not on the Kindle). */
export function visibleCount(issue: IssueView): number {
  return issue.stories.filter((s) => !s.hidden).length
}

/** "N of M read". */
export function readLine(issue: IssueView): string {
  return `${issue.read_count} of ${visibleCount(issue)} read`
}

/** Replace one card inside an issue. */
export function withStory(issue: IssueView, card: StoryCard): IssueView {
  return { ...issue, stories: issue.stories.map((s) => (s.id === card.id ? card : s)) }
}
