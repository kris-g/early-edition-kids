// Several children (CONTRACT.md "Profiles"). With one profile the app is exactly
// as it always was: pages under /dashboard/, the API under /api/dashboard. With
// more, each child's pages live under /dashboard/p/<id>/ and the API under
// /api/dashboard/p/<id>, and a switcher in the header moves between them.
//
// The router is mounted with the profile's basename, so every link inside the
// app (`/reading`, `/day/...`) stays relative to the current child.

import { createContext, useContext } from 'react'
import type { ProfileInfo } from '../api/types'
import { BASE_PATH } from '../config'

export type ProfileMode = {
  /** The profile shown now. */
  id: string
  /** True when paths carry /p/<id> (more than one profile, or none owns the root). */
  prefixed: boolean
}

export const SINGLE: ProfileMode = { id: 'default', prefixed: false }

/** Which child the parent looked at last, so /dashboard/ opens there again. */
export const LAST_PROFILE_KEY = 'early-edition.profile'

const DASHBOARD = BASE_PATH.replace(/\/$/, '') // '/dashboard'

let current: ProfileMode = SINGLE

/** Set before the router for a profile mounts (never during render). */
export function setCurrentProfile(mode: ProfileMode): void {
  current = mode
}

export function currentProfile(): ProfileMode {
  return current
}

/** A localStorage key for something that belongs to one child: unchanged with one profile. */
export function profileKey(base: string): string {
  return current.prefixed ? `${base}.${current.id}` : base
}

export function apiRootFor(mode: ProfileMode): string {
  return mode.prefixed ? `/api/dashboard/p/${encodeURIComponent(mode.id)}` : '/api/dashboard'
}

export function basenameFor(mode: ProfileMode): string {
  return mode.prefixed ? `${DASHBOARD}/p/${mode.id}` : DASHBOARD
}

/** '/dashboard/p/younger/reading' -> { id: 'younger', rest: '/reading' }; no /p/: id null. */
export function splitPath(pathname: string): { id: string | null; rest: string } {
  const m = pathname.match(/^\/dashboard\/p\/([^/]+)(\/.*)?$/)
  if (m) return { id: decodeURIComponent(m[1]), rest: m[2] || '/' }
  const rest = pathname.startsWith(`${DASHBOARD}/`) ? pathname.slice(DASHBOARD.length) : '/'
  return { id: null, rest }
}

/**
 * The profile to show for a location, and where to send the browser when the
 * location does not fit (a bookmark from before a second child was added, a
 * profile that was removed, or /dashboard/ itself).
 */
export function resolveLocation(
  profiles: ProfileInfo[],
  root: string | null,
  pathname: string,
  last: string | null,
): { mode: ProfileMode; redirect: string | null } {
  if (profiles.length === 0) return { mode: SINGLE, redirect: null }
  const { id, rest } = splitPath(pathname)
  const prefixed = profiles.length > 1 || root !== profiles[0].id
  if (!prefixed) {
    const mode = { id: profiles[0].id, prefixed: false }
    return { mode, redirect: id === null ? null : `${DASHBOARD}${rest}` }
  }
  if (id !== null && profiles.some((p) => p.id === id)) return { mode: { id, prefixed: true }, redirect: null }
  const target = last && profiles.some((p) => p.id === last) ? last : profiles[0].id
  // An unknown profile's page means nothing for another child: start at its front page.
  const keep = id === null ? rest : '/'
  return { mode: { id: target, prefixed: true }, redirect: `${DASHBOARD}/p/${target}${keep === '/' ? '/' : keep}` }
}

/** Top-level sections keep their place when switching child; anything deeper (a story, a day) goes to Today. */
const SECTIONS = ['/reading', '/calendar', '/find', '/topics', '/share', '/ai', '/issues', '/runs', '/more']

export function pathForSwitch(id: string, pathname: string): string {
  const { rest } = splitPath(pathname)
  const section = SECTIONS.find((s) => rest === s || rest === `${s}/`) ?? '/'
  return `${DASHBOARD}/p/${id}${section}`
}

export type ProfilesState = {
  profiles: ProfileInfo[]
  current: ProfileMode
  /** The built-in sign-in is on (show "Sign out"). */
  login: boolean
  switchTo: (id: string) => void
}

export const ProfilesContext = createContext<ProfilesState>({
  profiles: [],
  current: SINGLE,
  login: false,
  switchTo: () => {},
})

export function useProfiles(): ProfilesState {
  return useContext(ProfilesContext)
}
