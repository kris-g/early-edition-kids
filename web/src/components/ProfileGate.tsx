import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setApiRoot } from '../api/client'
import { api } from '../api/endpoints'
import type { ProfileInfo } from '../api/types'
import {
  LAST_PROFILE_KEY,
  ProfilesContext,
  SINGLE,
  apiRootFor,
  pathForSwitch,
  resolveLocation,
  setCurrentProfile,
  splitPath,
  type ProfileMode,
  type ProfilesState,
} from '../lib/profile'
import { readText, writeText } from '../lib/storage'

type Known = { profiles: ProfileInfo[]; root: string | null; login: boolean }

/** Point the API client and per-child storage at a profile. Called before it renders. */
function activate(mode: ProfileMode): void {
  setCurrentProfile(mode)
  setApiRoot(apiRootFor(mode))
  if (mode.prefixed) writeText(LAST_PROFILE_KEY, mode.id)
}

/**
 * Asks the server which children there are, settles which one the address is
 * for (redirecting /dashboard/ to the last one used), and renders `children`
 * for it. The children are keyed by profile, so switching starts that child's
 * pages afresh.
 */
export function ProfileGate({ children }: { children: (mode: ProfileMode) => ReactNode }) {
  const [known, setKnown] = useState<Known | null>(null)
  const [mode, setMode] = useState<ProfileMode | null>(null)

  const settle = useCallback((k: Known) => {
    const { mode: next, redirect } = resolveLocation(k.profiles, k.root, window.location.pathname, readText(LAST_PROFILE_KEY) || null)
    if (redirect) window.history.replaceState(window.history.state, '', redirect + window.location.search + window.location.hash)
    activate(next)
    setMode((m) => (m && m.id === next.id && m.prefixed === next.prefixed ? m : next))
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    api.profiles(ctrl.signal).then(
      (v) => {
        const k = { profiles: v.profiles, root: v.root, login: v.login }
        setKnown(k)
        settle(k)
      },
      (err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // An older server, or offline with nothing cached: the single-child app,
        // or the child the address names.
        const id = splitPath(window.location.pathname).id
        const k: Known = id ? { profiles: [{ id, title: id }], root: null, login: false } : { profiles: [], root: null, login: false }
        setKnown(k)
        settle(k)
      },
    )
    return () => ctrl.abort()
  }, [settle])

  // Back and forward can cross from one child's pages to another's.
  useEffect(() => {
    if (!known) return
    const onPop = () => settle(known)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [known, settle])

  const switchTo = useCallback(
    (id: string) => {
      if (!known || !known.profiles.some((p) => p.id === id)) return
      window.history.pushState(null, '', pathForSwitch(id, window.location.pathname))
      settle(known)
    },
    [known, settle],
  )

  const state = useMemo<ProfilesState>(
    () => ({ profiles: known?.profiles ?? [], current: mode ?? SINGLE, login: known?.login ?? false, switchTo }),
    [known, mode, switchTo],
  )

  if (!mode) return null
  return <ProfilesContext.Provider value={state}>{children(mode)}</ProfilesContext.Provider>
}
