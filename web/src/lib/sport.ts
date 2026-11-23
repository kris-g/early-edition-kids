import type { AboutView, SportPageUse } from '../api/types'
import { timeOf } from './format'

const PAGE_NAMES: Record<SportPageUse['page'], string> = { matches: 'Matches', table: 'Table', next: 'Fixtures', match: 'A match' }

/** A Sport page as a parent reads it: "Table", or a match by its name, such as "Liverpool 4–0 Man Utd". */
export function sportPageName(u: SportPageUse): string {
  return u.page === 'match' ? (u.match ?? PAGE_NAMES.match) : PAGE_NAMES[u.page]
}

export type FetchRow = { label: string; value: string; note?: string }

/**
 * The Sport page's last fetch from the football feeds, as rows for the Server page: when it
 * last worked and, when the last try went wrong, when that was and what the feeds said.
 */
export function sportFetchRows(sport: NonNullable<AboutView['sport']>, now: Date = new Date()): FetchRow[] {
  const rows: FetchRow[] = [{ label: 'Sport fetched', value: sport.updated_at ? timeOf(sport.updated_at, now) : 'Not yet' }]
  // A failure from before the last good fetch is over, so it isn't shown.
  if (sport.error && sport.attempted_at && (!sport.updated_at || sport.attempted_at >= sport.updated_at)) {
    // A try that kept some feeds moves updated_at to the same moment.
    const partly = sport.attempted_at === sport.updated_at
    rows.push({
      label: 'Last try',
      value: `${timeOf(sport.attempted_at, now)} · ${partly ? 'some feeds failed' : 'failed'}`,
      note: sport.error,
    })
  }
  return rows
}
