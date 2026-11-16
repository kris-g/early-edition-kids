// How the paper looks on this iPad: its colour (paper, sepia or night) and the size of the story
// text. The child picks them from the Aa button on a story; they are kept per profile mount and
// apply to the whole reader. The text size scales the age band's size, so it stays a step on
// from what suits the child's age rather than replacing it.

export type Theme = 'paper' | 'sepia' | 'night'

export const THEMES: { key: Theme; name: string }[] = [
  { key: 'paper', name: 'Paper' },
  { key: 'sepia', name: 'Sepia' },
  { key: 'night', name: 'Night' },
]

/** Text sizes, as a scale on the age band's size. The middle one is the age band's own. */
export const SIZES = [0.84, 0.92, 1, 1.1, 1.22, 1.36]
export const DEFAULT_SIZE = 2

/** The browser bar and status bar colour for each theme (the page's --paper). */
const BAR: Record<Theme, string> = { paper: '#fafaf7', sepia: '#f4ead5', night: '#1c1b19' }

export interface Look {
  theme: Theme
  /** An index into SIZES. */
  size: number
}

export const DEFAULT_LOOK: Look = { theme: 'paper', size: DEFAULT_SIZE }

/** A kept look, checked: anything unknown falls back to the default. */
export function readLook(raw: unknown): Look {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Look, unknown>>
  const theme = THEMES.some((t) => t.key === r.theme) ? (r.theme as Theme) : DEFAULT_LOOK.theme
  const size = typeof r.size === 'number' && Number.isInteger(r.size) && r.size >= 0 && r.size < SIZES.length ? r.size : DEFAULT_LOOK.size
  return { theme, size }
}

/** Put a look on the page: the theme on <html> (so the page behind the app matches), the size as --fs. */
export function applyLook(look: Look, doc: Document = document): void {
  const root = doc.documentElement
  root.dataset.theme = look.theme
  root.style.setProperty('--fs', String(SIZES[look.size]))
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[look.theme])
}
