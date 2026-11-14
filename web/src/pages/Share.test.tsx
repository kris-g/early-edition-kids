import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, shareView } from '../test/fixtures'
import { Share } from './Share'

const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(shareView()))

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  // jsdom has no canvas; the page must still render.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const page = (path = '/share') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Share />
    </MemoryRouter>,
  )

describe('Share', () => {
  it('shows all six cards as slides with dots, starting on the streak', async () => {
    page()
    expect(await screen.findByRole('img', { name: /Reading streak: 4 days in a row/ })).toBeInTheDocument()
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['/api/dashboard/share'])
    expect(screen.getAllByRole('group', { name: /of 6:/ })).toHaveLength(6)
    expect(screen.getByRole('heading', { name: 'Streak' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show the Streak card' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Previous card' })).toBeDisabled()
  })

  it('moves between cards with the arrows, the dots and the keyboard', async () => {
    page()
    await screen.findByRole('heading', { name: 'Streak' })
    await userEvent.click(screen.getByRole('button', { name: 'Next card' }))
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show the Ask me about card' }))
    expect(screen.getByRole('heading', { name: 'Ask me about' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next card' })).toBeDisabled()

    screen.getByRole('region', { name: /Share cards/ }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('heading', { name: 'Words learned' })).toBeInTheDocument()
  })

  it('opens on the card named in the address', async () => {
    page('/share?card=milestone')
    expect(await screen.findByRole('heading', { name: 'Milestone' })).toBeInTheDocument()
  })

  it('puts the name on the cards and remembers it on this device only', async () => {
    page()
    await screen.findByRole('heading', { name: 'Streak' })
    await userEvent.type(screen.getByLabelText('Name on the cards'), 'H.')
    expect(screen.getByRole('img', { name: /Ask about/ })).toBeInTheDocument()
    expect(localStorage.getItem('early-edition.share-name')).toBe('H.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('switches colour', async () => {
    page()
    await screen.findByRole('heading', { name: 'Streak' })
    await userEvent.click(screen.getByRole('button', { name: 'Night' }))
    expect(screen.getByRole('button', { name: 'Night' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('early-edition.share-theme')).toBe('night')
  })

  it('says why a card is not ready instead of drawing it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(shareView({ milestone: null, total_read: 7 })))
    page('/share?card=milestone')
    expect(await screen.findAllByText('Milestones start at 10 stories. He has read 7 stories so far.')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Save image' })).not.toBeInTheDocument()
  })
})
