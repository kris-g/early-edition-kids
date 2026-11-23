import type { ComponentType, SVGProps } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { APP_SHORT_NAME } from '../config'
import { cx } from '../lib/cx'
import { useSection } from '../lib/origin'
import { useProfiles } from '../lib/profile'
import { CalendarIcon, DotsIcon, LogoMark, PaperIcon, ReadingIcon } from './Icons'
import { ProfileSwitcher } from './ProfileSwitcher'
import { SideSignOut } from './SignOut'
import { ThemeButton, ThemeSwitch } from './ThemeToggle'

type Tab = { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }
type NavLink = { to: string; label: string }

/** Phone: bottom tabs for the pages looked at most. "More" holds the rest, in the sidebar's groups. */
const TABS: Tab[] = [
  { to: '/', label: 'Today', icon: PaperIcon },
  { to: '/reading', label: 'Reading', icon: ReadingIcon },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/more', label: 'More', icon: DotsIcon },
]

/**
 * Desktop and tablet (900px and wider): Today, then the sidebar's groups. Back issues has no entry of
 * its own: it is a list of the same papers the Calendar shows, and Calendar links to it.
 */
const NAV_GROUPS: { label: string; links: NavLink[] }[] = [
  {
    label: 'Reading',
    links: [
      { to: '/reading', label: 'Reading' },
      { to: '/calendar', label: 'Calendar' },
      { to: '/share', label: 'Share' },
    ],
  },
  {
    label: 'The paper',
    links: [
      { to: '/find', label: 'Add a story' },
      { to: '/topics', label: 'Topics' },
      { to: '/sport', label: 'Sport' },
      { to: '/ai', label: 'AI' },
    ],
  },
  {
    label: 'Set-up',
    links: [
      { to: '/devices', label: 'Devices' },
      { to: '/runs', label: 'Server' },
    ],
  },
]

/** Pages reached from "More" on a phone keep that tab lit. */
const UNDER_MORE = ['/share', '/find', '/topics', '/sport', '/ai', '/devices', '/runs', '/more']

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

function SideLink({ to, label, on }: NavLink & { on: boolean }) {
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'flex min-h-10 items-center rounded-[10px] px-3 text-[15px]',
        on ? 'bg-accent-soft font-bold text-accent' : 'font-medium text-ink hover:bg-chip',
      )}
    >
      {label}
    </Link>
  )
}

export function Layout() {
  // A day or a story lights the section it was opened from (lib/origin.ts).
  const section = useSection()
  const { login } = useProfiles()
  const tabOn = (to: string) => (to === '/more' ? UNDER_MORE.includes(section) : section === to)
  return (
    <div className="flex min-h-dvh desk:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-card px-4 py-6 desk:flex">
        <div className="px-2">
          <Brand />
        </div>
        <ProfileSwitcher wide />
        <nav aria-label="Sections" className="flex flex-col gap-5">
          <SideLink to="/" label="Today" on={section === '/'} />
          {NAV_GROUPS.map((g) => (
            <div key={g.label} role="group" aria-labelledby={`nav-group-${g.label}`} className="flex flex-col gap-0.5">
              <span
                id={`nav-group-${g.label}`}
                className="px-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-muted uppercase"
              >
                {g.label}
              </span>
              {g.links.map((l) => (
                <SideLink key={l.to} {...l} on={section === l.to} />
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2">
          <ThemeSwitch />
          {login && <SideSignOut />}
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
        <ul className="mx-auto grid max-w-md grid-cols-4">
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
