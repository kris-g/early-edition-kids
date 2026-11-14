// Light and dark theme. The default follows the system (prefers-color-scheme);
// a manual choice is remembered in localStorage. index.html applies the same
// rule in an inline script before first paint, so there is no flash.
import { useSyncExternalStore } from 'react'
import { THEME_DARK, THEME_LIGHT } from '../config'

export type Theme = 'light' | 'dark'
export const THEME_KEY = 'early-edition.theme'

const listeners = new Set<() => void>()
let current: Theme = 'light'

export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function resolveTheme(): Theme {
  return storedTheme() ?? systemTheme()
}

function apply(theme: Theme) {
  current = theme
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const color = theme === 'dark' ? THEME_DARK : THEME_LIGHT
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = color
  listeners.forEach((l) => l())
}

/** A manual choice: applied now and remembered. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // private mode: still switch for this visit
  }
  apply(theme)
}

export function toggleTheme(): void {
  setTheme(current === 'dark' ? 'light' : 'dark')
}

let stopSystem: (() => void) | null = null

/** Apply the theme and follow system changes while there is no manual choice. */
export function startTheme(): void {
  apply(resolveTheme())
  stopSystem?.()
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (storedTheme() === null) apply(systemTheme())
    }
    mq.addEventListener('change', onChange)
    stopSystem = () => mq.removeEventListener('change', onChange)
  } catch {
    stopSystem = null
  }
}

export function currentTheme(): Theme {
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, currentTheme)
}
