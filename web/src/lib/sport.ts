import type { SportPageUse } from '../api/types'

const PAGE_NAMES: Record<SportPageUse['page'], string> = { matches: 'Matches', table: 'Table', next: 'Fixtures', match: 'A match' }

/** A Sport page as a parent reads it: "Table", or a match by its name, such as "Liverpool 4–0 Man Utd". */
export function sportPageName(u: SportPageUse): string {
  return u.page === 'match' ? (u.match ?? PAGE_NAMES.match) : PAGE_NAMES[u.page]
}
