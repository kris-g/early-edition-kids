import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SportSettings, SportSettingsView, SportUsageView, UnlockStatus } from '../api/types'
import { jsonResponse } from '../test/fixtures'
import { Sport } from './Sport'

const today: UnlockStatus = {
  needed: 3,
  total: 6,
  counted: 1,
  unlocked: false,
  unlocked_at: null,
  stories: [
    { id: 1, title: 'Big stadium opens its pitch to schools', finished: true, active_seconds: 70, min_seconds: 60, counts: true, rushed: false },
    { id: 2, title: 'Rivers are getting cleaner', finished: true, active_seconds: 9, min_seconds: 55, counts: false, rushed: true },
    { id: 3, title: 'A rocket as tall as a tower block', finished: false, active_seconds: 20, min_seconds: 50, counts: false, rushed: false },
    { id: 4, title: 'Rescued sea turtles head back to sea', finished: false, active_seconds: 0, min_seconds: 50, counts: false, rushed: false },
  ],
}

const usage: SportUsageView = {
  from: '2026-11-17',
  to: '2026-11-23',
  days: [],
  views: 5,
  seconds: 330,
  pages: [
    { page: 'match', match_id: '2645301', match: 'Liverpool 4–0 Man Utd', views: 2, seconds: 200 },
    { page: 'table', match_id: null, match: null, views: 3, seconds: 130 },
  ],
}

let settings: SportSettings
const puts: unknown[] = []

const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input)
  if (url.startsWith('/api/dashboard/sport/settings')) {
    if (init?.method === 'PUT') {
      const patch = JSON.parse(String(init.body))
      puts.push(patch)
      settings = { ...settings, ...patch }
    }
    const body: SportSettingsView = { settings, today: settings.enabled && settings.read_first > 0 ? today : null }
    return jsonResponse(body)
  }
  if (url.startsWith('/api/dashboard/sport?days=7')) return jsonResponse(usage)
  return jsonResponse({ error: 'not here' }, 404)
})

beforeEach(() => {
  settings = { enabled: true, read_first: 0.5, min_reading: 0.5 }
  puts.length = 0
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const show = () =>
  render(
    <MemoryRouter>
      <Sport />
    </MemoryRouter>,
  )

describe('Sport page', () => {
  it('shows the settings, today’s progress with the story read too fast, and the week’s time on Sport', async () => {
    show()
    const page = await screen.findByRole('region', { name: 'Sport page' })
    expect(within(page).getByRole('switch')).toBeChecked()

    const first = screen.getByRole('region', { name: 'Read first' })
    expect(first).toHaveTextContent('Sport opens after reading 3 of today’s 6 stories.'.replace('’', "'"))
    expect(within(first).getByRole('button', { name: 'Half' })).toHaveAttribute('aria-pressed', 'true')

    // How fast is too fast is the Reading page's now.
    expect(screen.queryByRole('region', { name: 'Not too fast' })).not.toBeInTheDocument()
    expect(within(first).getByRole('link', { name: 'Reading' })).toHaveAttribute('href', '/reading')

    const day = screen.getByRole('region', { name: 'Today' })
    expect(day).toHaveTextContent('1 of 3 read; Sport is still closed. 1 story was read too fast to count.')
    expect(within(day).getByText('Too fast: 9 s of 55 s')).toBeInTheDocument()
    expect(within(day).getByText('Counts')).toBeInTheDocument()
    expect(within(day).getByText('Not finished')).toBeInTheDocument()
    expect(within(day).getByText('Not read yet')).toBeInTheDocument()

    const week = await screen.findByRole('region', { name: 'Time on Sport' })
    expect(week).toHaveTextContent('5 min 30 s in the last 7 days.')
    expect(week).toHaveTextContent('Liverpool 4–0 Man Utd')
    expect(week).toHaveTextContent('3 min 20 s · 2 looks')
    expect(week).toHaveTextContent('Table')
  })

  it('changes how much to read first', async () => {
    const user = userEvent.setup()
    show()
    const first = await screen.findByRole('region', { name: 'Read first' })
    await user.click(within(first).getByRole('button', { name: 'All' }))
    expect(puts).toEqual([{ read_first: 1 }])
    expect(within(first).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    // No lock: today's list goes, as there is nothing to open.
    await user.click(within(first).getByRole('button', { name: 'No' }))
    expect(puts[1]).toEqual({ read_first: 0 })
    expect(await screen.findByText('Sport is open from the start of the day.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeInTheDocument()
  })

  it('turns Sport off for this child', async () => {
    const user = userEvent.setup()
    show()
    const page = await screen.findByRole('region', { name: 'Sport page' })
    await user.click(within(page).getByRole('switch'))
    expect(puts).toEqual([{ enabled: false }])
    expect(within(page).getByRole('switch')).not.toBeChecked()
    expect(screen.queryByRole('region', { name: 'Read first' })).not.toBeInTheDocument()
  })
})
