import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, readingView } from '../test/fixtures'
import { Reading } from './Reading'

let minReading = 0.5
const puts: unknown[] = []
const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input)
  if (url.startsWith('/api/dashboard/reading/settings')) {
    if (init?.method === 'PUT') {
      const patch = JSON.parse(String(init.body))
      puts.push(patch)
      minReading = patch.min_reading
    }
    return jsonResponse({ min_reading: minReading })
  }
  const days = Number(new URL(url, 'http://x').searchParams.get('days'))
  return jsonResponse(readingView(days))
})

beforeEach(() => {
  minReading = 0.5
  puts.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const urls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => !u.includes('/reading/settings'))

describe('Reading range', () => {
  it('starts on 14 days and refetches when the range changes', async () => {
    render(
      <MemoryRouter>
        <Reading />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/of the last 14 days/)).toBeInTheDocument()
    expect(urls()).toEqual(['/api/dashboard/reading?days=14'])
    expect(screen.getByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: '30 days' }))
    expect(await screen.findByText(/of the last 30 days/)).toBeInTheDocument()
    expect(urls()).toContain('/api/dashboard/reading?days=30')
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '14 days' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: '12 weeks' }))
    expect(await screen.findByText(/of the last 84 days/)).toBeInTheDocument()
    expect(urls()).toContain('/api/dashboard/reading?days=84')
  })

  it('labels the charts with a summary of the data', async () => {
    render(
      <MemoryRouter>
        <Reading />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('group', { name: /Bar chart of stories read each day over 14 days/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Line chart of minutes spent reading/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Reading on \d+ of the last 14 days/ })).toBeInTheDocument()
  })

  it('sets how fast is too fast for this child, and counts the stories read too fast', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <Reading />
      </MemoryRouter>,
    )
    const card = await screen.findByRole('region', { name: 'Not too fast' })
    expect(await within(card).findByRole('button', { name: 'Half' })).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveTextContent('less than 50% of the time it should take')
    expect(card).toHaveTextContent('2 stories read too fast in the last 14 days.')
    await user.click(within(card).getByRole('button', { name: 'Any' }))
    expect(puts).toEqual([{ min_reading: 0 }])
    expect(card).toHaveTextContent('Any story read to the end counts as read properly')
  })
})
