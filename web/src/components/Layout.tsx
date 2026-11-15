import type { ComponentType, SVGProps } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { APP_SHORT_NAME } from '../config'
import { cx } from '../lib/cx'
import { useSection } from '../lib/origin'
import { CalendarIcon, DotsIcon, LogoMark, PaperIcon, ReadingIcon, SparkleIcon } from './Icons'
import { ProfileSwitcher } from './ProfileSwitcher'
import { ThemeButton, ThemeSwitch } from './ThemeToggle'

type Tab = { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }

/** Phone: bottom tabs. "More" holds Share, Find articles, Topics, Back issues and Recent runs. */
const TABS: Tab[] = [
  { to: '/', label: 'Today', icon: PaperIcon },
  { to: '/reading', label: 'Reading', icon: ReadingIcon },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/ai', label: 'AI', icon: SparkleIcon },
  { to: '/more', label: 'More', icon: DotsIcon },
]

/** Desktop and tablet (900px and wider): sidebar. */
const SIDE: { to: string; label: string }[] = [
  { to: '/', label: 'Overview' },
  { to: '/reading', label: 'Reading' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/find', label: 'Find articles' },
  { to: '/topics', label: 'Topics' },
  { to: '/share', label: 'Share' },
  { to: '/ai', label: 'AI' },
]

const SIDE_EXTRA: { to: string; label: string }[] = [
  { to: '/issues', label: 'Back issues' },
  { to: '/runs', label: 'Recent runs' },
  { to: '/more', label: 'More' },
]

function Brand() {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg">
      <LogoMark className="size-9 shrink-0 text-accent" />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate font-display text-[22px] leading-[1.1] font-black whitespace-nowrap">{APP_SHORT_NAME}</span>
        <span className="text-[11px] font-bold tracking-[0.12em] text-muted">PARENT DESK</span>
      </span>
    </Link>
  )
}

/** Pages reached from "More" on a phone keep that tab lit. */
const UNDER_MORE = ['/share', '/find', '/topics', '/issues', '/runs', '/more']

export function Layout() {
  // A day or a story lights the section it was opened from (lib/origin.ts).
  const section = useSection()
  const tabOn = (to: string) => (to === '/more' ? UNDER_MORE.includes(section) : section === to)
  return (
    <div className="flex min-h-dvh desk:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-card px-4 py-6 desk:flex">
        <div className="px-2">
          <Brand />
        </div>
        <ProfileSwitcher wide />
        <nav aria-label="Sections" className="flex flex-col gap-1">
          {SIDE.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              aria-current={section === t.to ? 'page' : undefined}
              className={
                cx(
                  'flex min-h-11 items-center rounded-[10px] px-3 text-[15px]',
                  section === t.to ? 'bg-accent-soft font-bold text-accent' : 'font-medium text-ink hover:bg-chip',
                )
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <nav aria-label="More" className="flex flex-col gap-0.5 border-t border-line pt-4">
          {SIDE_EXTRA.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              aria-current={section === t.to ? 'page' : undefined}
              className={
                cx(
                  'flex min-h-11 items-center rounded-[10px] px-3 text-sm',
                  section === t.to ? 'bg-accent-soft font-bold text-accent' : 'font-medium text-muted hover:bg-chip hover:text-ink',
                )
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <ThemeSwitch />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="header-safe flex items-center justify-between gap-2 px-5 pt-5 pb-3 desk:hidden">
          <Brand />
          <div className="flex shrink-0 items-center gap-1.5">
            <ProfileSwitcher />
            <ThemeButton />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[640px] flex-1 px-5 pt-1 pb-32 desk:max-w-[1180px] desk:px-8 desk:pt-7 desk:pb-10">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Sections"
        className="tab-bar fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card px-2 desk:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((t) => (
            <li key={t.to}>
              <Link
                to={t.to}
                aria-current={tabOn(t.to) ? 'page' : undefined}
                className={cx(
                  'flex min-h-11 flex-col items-center gap-1 border-t-[3px] pt-[9px] pb-1 text-[11px]',
                  tabOn(t.to) ? 'border-accent font-bold text-accent' : 'border-transparent font-medium text-muted',
                )}
              >
                <t.icon className="size-[22px]" />
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
