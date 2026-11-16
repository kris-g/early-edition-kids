import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from '../components/Icons'
import { Button, Card, PageHeader, SectionTitle } from '../components/ui'
import { APP_NAME } from '../config'
import { useProfiles } from '../lib/profile'

const LINKS: { to: string; label: string; hint: string }[] = [
  { to: '/devices', label: 'Devices', hint: 'Put the paper on a Kindle or an iPad' },
  { to: '/share', label: 'Share', hint: 'A picture of the streak, the week or a milestone, to send to family' },
  { to: '/find', label: 'Find articles', hint: 'Search the news or paste a link, for today or tomorrow' },
  { to: '/topics', label: 'Topics', hint: 'What the paper leans towards; pin or block' },
  { to: '/issues', label: 'Back issues', hint: 'Every paper from the last month' },
  { to: '/runs', label: 'Recent runs', hint: 'The daily job and what it did' },
]

export function More() {
  const { login } = useProfiles()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="More" />
      <nav aria-label="More pages" className="overflow-hidden rounded-2xl border border-line bg-card">
        {LINKS.map((l, i) => (
          <Link
            key={l.to}
            to={l.to}
            className={`flex min-h-16 items-center gap-3 px-[18px] py-3 hover:bg-chip ${i > 0 ? 'border-t border-line' : ''}`}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{l.label}</span>
              <span className="text-xs text-muted">{l.hint}</span>
            </span>
            <ChevronRight className="size-[18px] shrink-0 text-muted" />
          </Link>
        ))}
      </nav>

      <SectionTitle className="mt-2">Add this dashboard to your home screen</SectionTitle>
      <Card className="flex flex-col gap-2 text-sm">
        <Step label="iPhone">open this page in Safari, tap Share, then Add to Home Screen.</Step>
        <Step label="Android">open it in Chrome, tap the menu, then Add to home screen or Install app.</Step>
      </Card>

      {login ? (
        <SignOut />
      ) : (
        <Card className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Signed in through Authelia</span>
          <span className="text-[13px] text-muted">
            {APP_NAME} has no password of its own. Authelia keeps you signed in; when that runs out, the page takes you
            back to its sign-in.
          </span>
        </Card>
      )}
    </div>
  )
}

/** Caches that hold the children's reading, emptied on sign-out (vite.config.ts names them). */
const CACHES = ['early-edition-api', 'early-edition-pages']

/** The server's own sign-in (DASHBOARD_PASSWORD): a plain form post, so it works however the page is open. */
function SignOut() {
  const [busy, setBusy] = useState(false)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    setBusy(true)
    const clear = typeof caches === 'undefined' ? Promise.resolve() : Promise.all(CACHES.map((n) => caches.delete(n)))
    void clear.catch(() => {}).finally(() => form.submit())
  }
  return (
    <Card className="flex flex-col gap-3 desk:flex-row desk:items-center desk:justify-between">
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Signed in on this device</span>
        <span className="text-[13px] text-muted">You stay signed in for 30 days. Signing out also clears the copies kept for offline use.</span>
      </span>
      <form method="post" action="/logout" onSubmit={onSubmit} className="shrink-0">
        <Button type="submit" busy={busy}>
          Sign out
        </Button>
      </form>
    </Card>
  )
}

function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="m-0 text-muted">
      <span className="font-semibold text-ink">{label}:</span> {children}
    </p>
  )
}
