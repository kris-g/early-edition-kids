import { useSyncExternalStore } from 'react'
import { isSignedOut, reloadToSignIn, subscribeSignedOut } from '../lib/signedOut'
import { Button } from './ui'

/** Shown instead of looping reloads when the Authelia session has expired. */
export function SignedOutNotice() {
  const signedOut = useSyncExternalStore(subscribeSignedOut, isSignedOut, isSignedOut)
  if (!signedOut) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="signed-out-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 text-center text-ink shadow-xl"
      >
        <p id="signed-out-title" className="text-base font-medium">
          You’re signed out. Reload to sign in again.
        </p>
        <Button variant="primary" className="mt-4 w-full" onClick={reloadToSignIn}>
          Reload
        </Button>
      </div>
    </div>
  )
}
