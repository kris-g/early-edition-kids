import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_DARK, THEME_LIGHT } from '../config'
import { THEME_KEY, currentTheme, setTheme, startTheme, toggleTheme } from './theme'

let systemDark = false
const mqListeners = new Set<() => void>()

function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('dark') ? systemDark : false
    },
    media: query,
    addEventListener: (_: string, l: () => void) => mqListeners.add(l),
    removeEventListener: (_: string, l: () => void) => mqListeners.delete(l),
  }))
}

function flipSystem(dark: boolean) {
  systemDark = dark
  mqListeners.forEach((l) => l())
}

const meta = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content')

beforeEach(() => {
  localStorage.clear()
  systemDark = false
  mqListeners.clear()
  stubMatchMedia()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('theme', () => {
  it('follows the system by default', () => {
    systemDark = true
    startTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(meta()).toBe(THEME_DARK)
  })

  it('keeps following the system while there is no manual choice', () => {
    startTheme()
    expect(currentTheme()).toBe('light')
    flipSystem(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
  })

  it('remembers a manual choice and prefers it over the system', () => {
    startTheme()
    setTheme('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(meta()).toBe(THEME_DARK)

    // A new visit with a light system still opens dark.
    systemDark = false
    startTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    // And a later system change does not override it.
    flipSystem(true)
    flipSystem(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('toggles between light and dark', () => {
    startTheme()
    toggleTheme()
    expect(currentTheme()).toBe('dark')
    toggleTheme()
    expect(currentTheme()).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(meta()).toBe(THEME_LIGHT)
  })

  it('still works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    systemDark = true
    expect(() => startTheme()).not.toThrow()
    expect(currentTheme()).toBe('dark')
    expect(() => setTheme('light')).not.toThrow()
    expect(currentTheme()).toBe('light')
  })
})
