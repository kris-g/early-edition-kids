import { toggleTheme, useTheme } from '../lib/theme'
import { MoonIcon, SunIcon } from './Icons'

/** Phone header: a round sun or moon button. */
export function ThemeButton() {
  const theme = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      className="flex size-11 items-center justify-center rounded-full border border-line bg-card text-ink transition hover:bg-chip"
    >
      {dark ? <SunIcon className="size-[22px]" /> : <MoonIcon className="size-[22px]" />}
    </button>
  )
}

/** Desktop sidebar: a "Dark theme" switch. */
export function ThemeSwitch() {
  const dark = useTheme() === 'dark'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      onClick={toggleTheme}
      className="flex min-h-12 w-full items-center justify-between rounded-[10px] border border-line bg-transparent px-3 text-sm font-semibold text-ink hover:bg-chip"
    >
      Dark theme
      <span
        aria-hidden="true"
        className={`flex h-[26px] w-11 rounded-[13px] p-[3px] ${dark ? 'justify-end bg-accent' : 'justify-start bg-muted'}`}
      >
        <span className="size-5 rounded-full bg-card" />
      </span>
    </button>
  )
}
