import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiPage } from '../api/routes'
import { aiPage, jsonResponse } from '../test/fixtures'
import { Ai } from './Ai'

let server: AiPage
const puts: unknown[] = []

const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  if (String(input) === '/api/dashboard/ai' && init?.method === 'PUT') {
    const body = JSON.parse(String(init.body))
    puts.push(body)
    server = {
      ...server,
      settings: { ...server.settings, ...body },
      month: { ...server.month, limit_usd: 'monthly_limit_usd' in body ? body.monthly_limit_usd : server.month.limit_usd },
    }
    return jsonResponse(server)
  }
  return jsonResponse(server)
})

beforeEach(() => {
  server = aiPage()
  puts.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderAi() {
  return render(
    <MemoryRouter>
      <Ai />
    </MemoryRouter>,
  )
}

describe('AI page', () => {
  it('shows the live estimate and saves only what changed', async () => {
    const user = userEvent.setup()
    renderAi()
    const use = await screen.findByRole('button', { name: 'Use from tomorrow’s paper' })
    expect(use).toBeDisabled()
    expect(screen.getByText('$0.46')).toBeInTheDocument() // 0.34 + 0.12

    await user.click(screen.getByRole('radio', { name: /Claude Sonnet 5.5/ }))
    // 0.17 + 0.12 = 0.29 a day, 8.70 a month
    expect(screen.getByText('$0.29')).toBeInTheDocument()
    expect(screen.getByText(/a day · \$8.70 a month/)).toBeInTheDocument()
    expect(use).toBeEnabled()

    await user.click(use)
    expect(puts).toEqual([{ writer_model: 'anthropic:claude-sonnet-5-5' }])
    expect(await screen.findByText(/Saved/)).toBeInTheDocument()
    expect(use).toBeDisabled()
  })

  it('sends the checker and effort together when both change', async () => {
    const user = userEvent.setup()
    renderAi()
    await screen.findByRole('button', { name: 'Use from tomorrow’s paper' })
    await user.click(screen.getByRole('button', { name: 'Haiku 5.5' }))
    await user.click(screen.getByRole('button', { name: 'Medium' }))
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Use from tomorrow’s paper' }))
    expect(puts).toEqual([{ check_model: 'anthropic:claude-haiku-5-5', check_effort: 'medium' }])
  })

  it('validates the monthly limit before sending it', async () => {
    const user = userEvent.setup()
    renderAi()
    const input = await screen.findByLabelText('Monthly limit')
    await user.clear(input)
    await user.type(input, '-5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/like 25 or 12.50/)
    expect(puts).toEqual([])

    await user.clear(input)
    await user.type(input, '30')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(puts).toEqual([{ monthly_limit_usd: 30 }])
    expect(await screen.findByText('Limit set to $30 a month.')).toBeInTheDocument()
  })

  it('removes the limit with null', async () => {
    const user = userEvent.setup()
    renderAi()
    await user.click(await screen.findByRole('button', { name: 'Remove limit' }))
    expect(puts).toEqual([{ monthly_limit_usd: null }])
    expect(await screen.findByText('no monthly limit')).toBeInTheDocument()
  })

  it('lists each provider with its state', async () => {
    renderAi()
    expect(await screen.findByText(/Connected · last used/)).toBeInTheDocument()
    expect(screen.getByText('Not set up: add the key on the server')).toBeInTheDocument()
  })
})
