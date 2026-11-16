import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopicView } from '../api/types'
import { jsonResponse } from '../test/fixtures'
import { Topics } from './Topics'

function topic(name: string, over: Partial<TopicView> = {}): TopicView {
  return {
    name,
    description: `All about ${name.toLowerCase()}.`,
    base_weight: 2,
    effective_weight: 2.4,
    mode: null,
    shown: 10,
    opened: 8,
    engaged: 6,
    open_rate: 0.8,
    engagement_rate: 0.6,
    ...over,
  }
}

let server: TopicView[]
const posts: { name: string; mode: unknown }[] = []
let failNext = false

const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
  const url = String(input)
  const m = url.match(/^\/api\/dashboard\/topics\/(.+)$/)
  if (m && init?.method === 'POST') {
    if (failNext) {
      failNext = false
      return jsonResponse({ error: 'the database is busy' }, 500)
    }
    const name = decodeURIComponent(m[1])
    const { mode } = JSON.parse(String(init.body))
    posts.push({ name, mode })
    server = server.map((t) => (t.name === name ? { ...t, mode, effective_weight: mode === 'block' ? 0 : t.effective_weight } : t))
    return jsonResponse(server.find((t) => t.name === name))
  }
  return jsonResponse(server)
})

beforeEach(() => {
  server = [
    topic('Football'),
    topic('Science', { mode: 'pin' }),
    topic('Space', { description: null, shown: 0, opened: 0, engaged: 0 }),
    topic('Weather', { mode: 'block', effective_weight: 0 }),
  ]
  posts.length = 0
  failNext = false
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderTopics() {
  return render(
    <MemoryRouter>
      <Topics />
    </MemoryRouter>,
  )
}

const row = (name: string) => screen.findByRole('region', { name })
const onOff = (r: HTMLElement) => within(r).getByRole('switch')
const pin = (r: HTMLElement) => within(r).getByRole('button', { name: /^Pin / })

describe('Topics page', () => {
  it('shows each topic with its description, or its state when pinned or off, and counts the ones that are on', async () => {
    renderTopics()
    const football = await row('Football')
    expect(football).toHaveTextContent('All about football.')
    expect(onOff(football)).toBeChecked()
    expect(pin(football)).toHaveAttribute('aria-pressed', 'false')

    const science = await row('Science')
    expect(science).toHaveTextContent('Pinned')
    expect(science).not.toHaveTextContent('All about science.')
    expect(pin(science)).toHaveAttribute('aria-pressed', 'true')

    const weather = await row('Weather')
    expect(weather).toHaveTextContent('Blocked for this child')
    expect(onOff(weather)).not.toBeChecked()
    expect(pin(weather)).toBeDisabled()

    // No description in the config: just the name.
    expect(await row('Space')).not.toHaveTextContent('All about')
    expect(screen.getByText('3 of 4 on')).toBeInTheDocument()
  })

  it('turning a topic off blocks it, and on again clears the block', async () => {
    const user = userEvent.setup()
    renderTopics()
    const football = await row('Football')
    await user.click(onOff(football))
    expect(posts).toEqual([{ name: 'Football', mode: 'block' }])
    expect(await within(football).findByText('Blocked for this child')).toBeInTheDocument()
    expect(onOff(football)).not.toBeChecked()
    expect(screen.getByText('2 of 4 on')).toBeInTheDocument()

    await user.click(onOff(football))
    expect(posts[1]).toEqual({ name: 'Football', mode: null })
    expect(await within(football).findByText('All about football.')).toBeInTheDocument()
    expect(screen.getByText('3 of 4 on')).toBeInTheDocument()
  })

  it('pins and unpins with the Pin toggle', async () => {
    const user = userEvent.setup()
    renderTopics()
    const football = await row('Football')
    await user.click(pin(football))
    expect(posts).toEqual([{ name: 'Football', mode: 'pin' }])
    expect(await within(football).findByText('Pinned')).toBeInTheDocument()
    expect(onOff(football)).toBeChecked()

    const science = await row('Science')
    await user.click(pin(science))
    expect(posts[1]).toEqual({ name: 'Science', mode: null })
    expect(await within(science).findByText('All about science.')).toBeInTheDocument()
  })

  it('keeps the weight and the 14-day numbers behind Details, one row at a time', async () => {
    const user = userEvent.setup()
    renderTopics()
    const football = await row('Football')
    expect(screen.queryByText(/Last 14 days/)).not.toBeInTheDocument()
    const details = within(football).getByRole('button', { name: 'Details' })
    expect(details).toHaveAttribute('aria-expanded', 'false')

    await user.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(football).toHaveTextContent('Weight 2.4 · base 2')
    expect(football).toHaveTextContent('Last 14 days: shown 10, opened 8, engaged 6. Open rate 80%, engagement rate 60%.')
    expect(await row('Science')).not.toHaveTextContent('Last 14 days')

    const space = await row('Space')
    await user.click(within(space).getByRole('button', { name: 'Details' }))
    expect(space).toHaveTextContent('Not shown in the last 14 days.')

    await user.click(details)
    expect(football).not.toHaveTextContent('Last 14 days')
  })

  it('says so when a change could not be saved, and leaves the topic as it was', async () => {
    const user = userEvent.setup()
    renderTopics()
    const football = await row('Football')
    failNext = true
    await user.click(onOff(football))
    expect(await within(football).findByRole('alert')).toBeInTheDocument()
    expect(onOff(football)).toBeChecked()
    expect(screen.getByText('3 of 4 on')).toBeInTheDocument()
  })
})
