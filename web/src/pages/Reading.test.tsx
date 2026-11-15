import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, readingView } from '../test/fixtures'
import { Reading } from './Reading'

const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const days = Number(new URL(String(input), 'http://x').searchParams.get('days'))
  return jsonResponse(readingView(days))
})

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

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
})
