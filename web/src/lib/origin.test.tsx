import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DayView } from '../api/types'
import { AppRoutes } from '../App'
import { jsonResponse } from '../test/fixtures'
import { labelOf, sectionOf, type Origin } from './origin'

describe('sectionOf and labelOf', () => {
  it('puts a day and Back issues under Calendar, and a story under Today, when nothing says otherwise', () => {
    expect(sectionOf('/day/2026-11-13')).toBe('/calendar')
    expect(sectionOf('/story/53')).toBe('/')
    expect(sectionOf('/issues')).toBe('/calendar')
    expect(sectionOf('/calendar')).toBe('/calendar')
  })

  it('names the page a back link returns to', () => {
    expect(labelOf('/day/2026-11-15')).toBe('Sun 15 Nov')
    expect(labelOf('/')).toBe('Today')
    expect(labelOf('/issues')).toBe('Back issues')
    expect(labelOf('/runs')).toBe('Server')
  })
})

const friday: DayView = { date: '2026-11-13', read: 0, minutes: 0, reads: [], paper: null, sport: null }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-15T20:00:00Z') })
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(friday)))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function openDay(origin?: Origin) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/day/2026-11-13', state: origin ? { origin } : null }]}>
      <AppRoutes />
    </MemoryRouter>,
  )
  return within(screen.getAllByRole('navigation', { name: 'Sections' }).at(-1)!)
}

describe('a day opened from somewhere', () => {
  it('keeps the tab it came from lit and offers a way back', async () => {
    const tabs = openDay({ section: '/reading', back: { to: '/reading', label: 'Reading' } })
    expect(await within(screen.getByRole('main')).findByRole('link', { name: 'Reading' })).toHaveAttribute('href', '/reading')
    expect(tabs.getByRole('link', { name: 'Reading' })).toHaveAttribute('aria-current', 'page')
    expect(tabs.getByRole('link', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
  })

  it('opened directly, it belongs to the Calendar', async () => {
    const tabs = openDay()
    expect(await within(screen.getByRole('main')).findByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/calendar?month=2026-11&day=2026-11-13',
    )
    expect(tabs.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
  })
})
