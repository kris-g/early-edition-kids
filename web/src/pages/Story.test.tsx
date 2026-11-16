import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryDetail } from '../api/types'
import { card, jsonResponse } from '../test/fixtures'
import { Story } from './Story'

const detail = (id: number, prev: number | null, next: number | null): StoryDetail => ({
  ...card({ id, position: id - 40, title: `Story number ${id}` }),
  body_html: '<p>Text.</p>',
  word_to_know: null,
  think_about_it: 'Why?',
  prev_id: prev,
  next_id: next,
  image: null,
  checks: null,
  created_at: '2026-11-13T05:31:07+00:00',
})
const stories: Record<string, StoryDetail> = { '41': detail(41, null, 42), '42': detail(42, 41, 43), '43': detail(43, 42, null) }

const fetchMock = vi.fn<typeof fetch>(async (url) => jsonResponse(stories[String(url).split('/').pop() ?? '']))
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const page = (id: number) =>
  render(
    <MemoryRouter initialEntries={[`/story/${id}`]}>
      <Routes>
        <Route path="/story/:id" element={<Story />} />
      </Routes>
    </MemoryRouter>,
  )

describe('Story', () => {
  it('has previous and next arrows beside the story number', async () => {
    page(42)
    expect(await screen.findByRole('heading', { name: 'Story number 42' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Previous and next story' })
    expect(nav).toHaveTextContent('Story 2')
    expect(screen.getByRole('link', { name: 'Previous story' })).toHaveAttribute('href', '/story/41')
    expect(screen.getByRole('link', { name: 'Next story' })).toHaveAttribute('href', '/story/43')
    await userEvent.click(screen.getByRole('link', { name: 'Next story' }))
    expect(await screen.findByRole('heading', { name: 'Story number 43' })).toBeInTheDocument()
    // The last story has no next arrow to follow.
    expect(screen.queryByRole('link', { name: 'Next story' })).not.toBeInTheDocument()
  })

  it('goes back and forth with the left and right arrow keys', async () => {
    page(42)
    await screen.findByRole('heading', { name: 'Story number 42' })
    await userEvent.keyboard('{ArrowRight}')
    expect(await screen.findByRole('heading', { name: 'Story number 43' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}') // nothing after the last
    expect(screen.getByRole('heading', { name: 'Story number 43' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    expect(await screen.findByRole('heading', { name: 'Story number 42' })).toBeInTheDocument()
    await userEvent.keyboard('{ArrowLeft}')
    expect(await screen.findByRole('heading', { name: 'Story number 41' })).toBeInTheDocument()
    // Not with a modifier held (the browser's own back and forward).
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(screen.getByRole('heading', { name: 'Story number 41' })).toBeInTheDocument()
  })
})
