import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from '../components/Icons'
import { Card, PageHeader, SectionTitle } from '../components/ui'
import { APP_NAME } from '../config'

const LINKS: { to: string; label: string; hint: string }[] = [
  { to: '/share', label: 'Share', hint: 'A picture of his streak, his week or a milestone, to send to family' },
  { to: '/find', label: 'Find articles', hint: 'Search the news or paste a link, for today or tomorrow' },
  { to: '/topics', label: 'Topics', hint: 'What the paper leans towards; pin or block' },
  { to: '/issues', label: 'Back issues', hint: 'Every paper from the last month' },
  { to: '/runs', label: 'Recent runs', hint: 'The daily job and what it did' },
]

export function More() {
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

      <SectionTitle className="mt-2">Add to your home screen</SectionTitle>
      <Card className="flex flex-col gap-2 text-sm">
        <Step label="iPhone">open this page in Safari, tap Share, then Add to Home Screen.</Step>
        <Step label="Android">open it in Chrome, tap the menu, then Add to home screen or Install app.</Step>
      </Card>

      <Card className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Signed in through Authelia</span>
        <span className="text-[13px] text-muted">
          {APP_NAME} has no password of its own. Authelia keeps you signed in; when that runs out, the page takes you
          back to its sign-in.
        </span>
      </Card>
    </div>
  )
}

function Step({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="m-0 text-muted">
      <span className="font-semibold text-ink">{label}:</span> {children}
    </p>
  )
}
