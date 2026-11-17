import { useState, type FormEvent, type ReactNode } from 'react'
import { cx } from '../lib/cx'

/** Caches that hold the children's reading, emptied on sign-out (vite.config.ts names them). */
const CACHES = ['early-edition-api', 'early-edition-pages']

/**
 * The server's own sign-in (DASHBOARD_PASSWORD): a plain form post to /logout, so it works however
 * the page is open. The offline copies of the children's reading are emptied first.
 */
export function SignOutForm({ className, children }: { className?: string; children: (busy: boolean) => ReactNode }) {
  const [busy, setBusy] = useState(false)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    const clear = typeof caches === 'undefined' ? Promise.resolve() : Promise.all(CACHES.map((n) => caches.delete(n)))
    void clear.catch(() => {}).finally(() => form.submit())
  }
  return (
    <form method="post" action="/logout" onSubmit={onSubmit} className={className}>
      {children(busy)}
    </form>
  )
}

/** The sidebar's quiet "Sign out", under the theme switch. */
export function SideSignOut() {
  return (
    <SignOutForm>
      {(busy) => (
        <button
          type="submit"
          disabled={busy}
          className={cx(
            'flex min-h-10 w-full items-center rounded-[10px] px-3 text-left text-sm font-medium text-muted hover:bg-chip hover:text-ink',
            busy && 'cursor-wait opacity-60',
          )}
        >
          Sign out
        </button>
      )}
    </SignOutForm>
  )
}
