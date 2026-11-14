// Authelia (on the cluster edge) is the only lock; the app has no login of its own.
// When the Authelia session expires, an API fetch gets a redirect to the sign-in
// page instead of JSON. We reload once so the browser goes through Authelia and
// comes back. If we already reloaded in the last 30 seconds (the sign-in did not
// stick, or something keeps redirecting), we stop and show a plain message.

export const RELOAD_KEY = 'early-edition.authReloadAt'
export const RELOAD_GUARD_MS = 30_000

/** Swappable for tests (jsdom's location.reload cannot be spied on). */
export const signedOutDeps = {
  reload: () => window.location.reload(),
  now: () => Date.now(),
}

let signedOut = false
const listeners = new Set<() => void>()

function readStamp(): number | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY)
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

function writeStamp(value: number | null): void {
  try {
    if (value === null) sessionStorage.removeItem(RELOAD_KEY)
    else sessionStorage.setItem(RELOAD_KEY, String(value))
  } catch {
    // storage blocked: the guard falls back to always showing the message
  }
}

/**
 * Called by the API client on a redirect or 401. Returns 'reloading' when it
 * reloaded the page, 'blocked' when it showed the signed-out message instead.
 */
export function handleSignedOut(): 'reloading' | 'blocked' {
  const now = signedOutDeps.now()
  const last = readStamp()
  const storageWorks = (() => {
    try {
      sessionStorage.setItem(`${RELOAD_KEY}.probe`, '1')
      sessionStorage.removeItem(`${RELOAD_KEY}.probe`)
      return true
    } catch {
      return false
    }
  })()
  const reloadedRecently = last !== null && now >= last && now - last < RELOAD_GUARD_MS
  if (storageWorks && !reloadedRecently) {
    writeStamp(now)
    signedOutDeps.reload()
    return 'reloading'
  }
  if (!signedOut) {
    signedOut = true
    listeners.forEach((l) => l())
  }
  return 'blocked'
}

/** The parent asked to reload: let it through even inside the guard window. */
export function reloadToSignIn(): void {
  writeStamp(null)
  signedOutDeps.reload()
}

export function isSignedOut(): boolean {
  return signedOut
}

export function subscribeSignedOut(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** For tests. */
export function resetSignedOut(): void {
  signedOut = false
  writeStamp(null)
}
