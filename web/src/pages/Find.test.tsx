import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArticleHit } from '../api/types'
import { JobsProvider } from '../components/JobsProvider'
import { card, job, jsonResponse } from '../test/fixtures'
import { Find } from './Find'

const hit = (over: Partial<ArticleHit> = {}): ArticleHit => ({
  url: 'https://www.bbc.co.uk/news/frog',
  source_name: 'BBC Newsround',
  title: 'Scientists find a frog that glows',
  summary: 'It lives in the rainforest.',
  published_at: '2026-11-12T08:00:00Z',
  already_used: false,
  ...over,
})

let jobPolls = 0
let finalJob = job({ status: 'done', story: card({ id: 500, title: 'A frog that glows', added_by_parent: true }) })

const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const url = String(input)
  if (url.startsWith('/api/dashboard/articles/search')) {
    return jsonResponse([hit(), hit({ url: 'https://x.test/used', title: 'Old news', already_used: true })])
  }
  if (url === '/api/dashboard/articles/add') return jsonResponse(job(), 202)
  if (url.startsWith('/api/dashboard/jobs/')) {
    jobPolls++
    return jsonResponse(jobPolls < 2 ? job() : finalJob)
  }
  return jsonResponse({ error: 'unexpected' }, 500)
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', fetchMock)
  jobPolls = 0
  try {
    localStorage.clear()
  } catch {
    // ignore
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderFind() {
  return render(
    <MemoryRouter>
      <JobsProvider>
        <Find />
      </JobsProvider>
    </MemoryRouter>,
  )
}

describe('Find articles', () => {
  it('adds an article: pending, then the new story card', async () => {
    finalJob = job({ status: 'done', story: card({ id: 500, title: 'A frog that glows', added_by_parent: true }) })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderFind()
    expect(await screen.findByText('Scientists find a frog that glows')).toBeInTheDocument()
    expect(screen.getByText('Already used')).toBeInTheDocument()
    expect(screen.getByText(/rewritten for him and safety-checked/)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Add to today' })[0])
    expect(await screen.findByText(/Rewriting and checking for today’s issue/)).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(4100))
    expect(await screen.findByText('Added to today’s issue.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /A frog that glows/ })).toHaveAttribute('href', '/story/500')
    expect(jobPolls).toBe(2)
  })

  it('shows the reasons when the checks fail', async () => {
    finalJob = job({ status: 'failed', reasons: ['It could upset an 8 year old.'] })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderFind()
    await user.click((await screen.findAllByRole('button', { name: 'Add for tomorrow' }))[0])
    await act(() => vi.advanceTimersByTimeAsync(4100))
    expect(await screen.findByText(/Not added/)).toBeInTheDocument()
    expect(screen.getByText('It could upset an 8 year old.')).toBeInTheDocument()
  })
})
