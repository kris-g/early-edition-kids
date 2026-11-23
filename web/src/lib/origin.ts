// Where a detail page (a day or a story) was opened from, so it can light that
// section's tab and offer a back link to it.
//
// Links into a detail page pass `state={useOrigin()}`. The detail page keeps the
// state when it moves sideways (the next day, the next story), so the tab and
// the back link still point at where you started.

import { useLocation } from 'react-router-dom'
import { weekdayDayMonthShort } from './format'

export type Origin = {
  /** The section to light: a sidebar path ('/', '/calendar', '/issues', ...). */
  section: string
  /** Where "back" goes, and what it says. */
  back: { to: string; label: string }
}

const SECTIONS = ['/reading', '/calendar', '/find', '/topics', '/sport', '/share', '/ai', '/issues', '/runs', '/devices', '/more']

/** The section a path belongs to when nothing says otherwise (opened from a bookmark). */
export function sectionOf(pathname: string): string {
  // Back issues is the Calendar's papers as a list, so it lights Calendar too.
  if (pathname.startsWith('/day/') || pathname === '/issues' || pathname.startsWith('/issues/')) return '/calendar'
  return SECTIONS.find((s) => pathname === s || pathname.startsWith(`${s}/`)) ?? '/'
}

const LABELS: Record<string, string> = {
  '/reading': 'Reading',
  '/calendar': 'Calendar',
  '/find': 'Add a story',
  '/topics': 'Topics',
  '/sport': 'Sport',
  '/share': 'Share',
  '/ai': 'AI',
  '/issues': 'Back issues',
  '/runs': 'Server',
  '/devices': 'Devices',
  '/more': 'More',
}

/** What a back link to this page says: "Calendar", "Today", "Sun 15 Nov", "Story". */
export function labelOf(pathname: string): string {
  const day = pathname.match(/^\/day\/(\d{4}-\d{2}-\d{2})/)
  if (day) return weekdayDayMonthShort(day[1])
  if (pathname.startsWith('/story/')) return 'Story'
  if (pathname === '/') return 'Today'
  if (pathname === '/issues') return 'Back issues'
  return LABELS[sectionOf(pathname)] ?? 'Back'
}

export function originOf(state: unknown): Origin | null {
  const o = (state as { origin?: Origin } | null)?.origin
  return o && typeof o.section === 'string' && o.back && typeof o.back.to === 'string' ? o : null
}

/** Router state for a link from the current page into a day or a story. */
export function useOrigin(): { origin: Origin } {
  const { pathname, search, state } = useLocation()
  const here = originOf(state)
  return {
    origin: {
      // A detail page opened from somewhere keeps that section lit for what it opens too.
      section: here?.section ?? sectionOf(pathname),
      back: { to: pathname + search, label: labelOf(pathname) },
    },
  }
}

/** The section to light for the current page. */
export function useSection(): string {
  const { pathname, state } = useLocation()
  return originOf(state)?.section ?? sectionOf(pathname)
}
