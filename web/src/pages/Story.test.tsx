import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueView, StoryDetail } from '../api/types'
import { addDaysIso, londonToday } from '../lib/format'
import { card, checks, detail as checkedStory, jsonResponse, stats } from '../test/fixtures'
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

// --- the paper view: the list beside the story, the checks line and the notes ---

const TODAY = londonToday()
const YESTERDAY = addDaysIso(TODAY, -1)
const read = stats({ opened: true, reached_end: true, active_seconds: 110, read_on: TODAY })

const paper = (date: string, stories: IssueView['stories']): IssueView => ({
  date,
  version: 1,
  fallback: false,
  created_at: `${date}T05:31:00Z`,
  downloaded_by: [],
  read_count: stories.filter((s) => !s.hidden && s.stats.reached_end).length,
  stories,
})

const kane = card({ id: 41, date: TODAY, position: 1, stats: read })
const rocket = card({ id: 42, date: TODAY, position: 2, topic: 'Space', title: 'A rocket as tall as a tower block', minutes: 3, hidden: true })
const frost = card({ id: 31, date: YESTERDAY, position: 1, topic: 'Weather', title: 'First frost of the winter', minutes: 1 })

const papers: Record<string, IssueView> = { [TODAY]: paper(TODAY, [rocket, kane]), [YESTERDAY]: paper(YESTERDAY, [frost]) }
const details: Record<string, StoryDetail> = {
  '41': checkedStory({ ...kane, next_id: 42, created_at: `${TODAY}T05:31:07+00:00` }),
  '42': checkedStory({ ...rocket, prev_id: 41, body_html: '<h1>A rocket as tall as a tower block</h1><p>It is tall.</p>', checks: checks({ numbers: [] }) }),
  // Written before checks were kept: no checks, and so no marks in its body.
  '31': checkedStory({
    ...frost,
    body_html: '<h1>First frost of the winter</h1><p>It was 2 degrees below zero in the <b>ceremony</b> field.</p>',
    checks: null,
    created_at: `${YESTERDAY}T05:33:00+00:00`,
  }),
}

const paperFetch = vi.fn<typeof fetch>(async (input) => {
  const url = String(input)
  const last = url.split('/').pop() ?? ''
  if (url.includes('/issues?')) return jsonResponse([TODAY, YESTERDAY].map((date) => ({ date, version: 1, fallback: false, story_count: 1, read_count: 0 })))
  if (url.includes('/issues/')) return jsonResponse(papers[last])
  return jsonResponse(details[last])
})

/** As on a wide screen: every media query matches. */
const wide = () =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }))

describe('Story, the paper view on a wide screen', () => {
  beforeEach(() => {
    paperFetch.mockClear()
    vi.stubGlobal('fetch', paperFetch)
    wide()
  })

  it('lists today’s stories then earlier days beside the open story', async () => {
    page(41)
    const list = await screen.findByRole('navigation', { name: 'Stories' })
    const today = await within(list).findByRole('region', { name: 'Today' })
    const yesterday = await within(list).findByRole('region', { name: 'Yesterday' })
    expect(today.compareDocumentPosition(yesterday) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(today).getByText('1 of 1 read')).toBeInTheDocument() // the hidden one is not counted

    // In paper order, each with its topic, title, status, reading time and a Hidden badge.
    const rows = await within(today).findAllByRole('link')
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/story/41', '/story/42'])
    expect(rows[0]).toHaveAttribute('aria-current', 'page')
    expect(rows[0]).toHaveTextContent('Football')
    expect(rows[0]).toHaveTextContent('Harry Kane wins the Ballon d’Or')
    expect(rows[0]).toHaveTextContent('Read · 1 min 50 s')
    expect(rows[0]).toHaveTextContent('2 min')
    expect(rows[0]).not.toHaveTextContent('Hidden')
    expect(rows[1]).not.toHaveAttribute('aria-current')
    expect(rows[1]).toHaveTextContent('Not opened yet')
    expect(rows[1]).toHaveTextContent('3 min')
    expect(rows[1]).toHaveTextContent('Hidden')
    expect(await within(yesterday).findByRole('link', { name: /First frost of the winter/ })).toBeInTheDocument()

    // Choosing another opens it on the right and moves the highlight; the list stays.
    await userEvent.click(rows[1])
    expect(await screen.findByRole('heading', { name: 'A rocket as tall as a tower block' })).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: /A rocket as tall/ })).toHaveAttribute('aria-current', 'page')
    expect(within(list).getByRole('link', { name: /Harry Kane/ })).not.toHaveAttribute('aria-current')
  })

  it('shows when it was written, the model and the checker’s verdict above the story', async () => {
    page(41)
    expect(await screen.findByText(/^Written 05:31 by Claude Opus 5\.5/)).toHaveTextContent(
      /^Written 05:31 by Claude Opus 5\.5 · Checked against its source$/,
    )
  })

  it('adds the checker’s reasons when it gave any', async () => {
    details['41'] = { ...details['41'], checks: checks({ verdict: { safe: true, supported: true, reasons: ['Both figures are in the article.'] } }) }
    page(41)
    expect(await screen.findByText(/Checked against its source/)).toBeInTheDocument()
    expect(screen.getByText(/^Written/)).toHaveTextContent('· The checker said: Both figures are in the article.')
    details['41'] = { ...details['41'], checks: checks() }
  })

  it('shows a number’s note by pointer and the word’s by keyboard', async () => {
    page(41)
    const number = await screen.findByRole('button', { name: '25, number check' })
    expect(number).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()

    await userEvent.click(number)
    const note = screen.getByRole('complementary', { name: 'Number check' })
    expect(note).toHaveTextContent('25 matches the source article.')
    expect(number).toHaveAttribute('aria-expanded', 'true')

    // Another mark takes the note over; Enter and Space work on the focused mark.
    const word = screen.getByRole('button', { name: 'ceremony, word to know' })
    word.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('complementary', { name: 'Word to know' })).toHaveTextContent('Ceremony: a special event held to celebrate something.')
    expect(number).toHaveAttribute('aria-expanded', 'false')
    expect(word).toHaveAttribute('aria-expanded', 'true')
    expect(word).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()

    // Escape and a press elsewhere put it away too.
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '61, number check' }))
    expect(screen.getByRole('complementary')).toHaveTextContent('61 matches the source article.')
    await userEvent.click(screen.getByText('Reading'))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('shows a story with no checks without notes or marks', async () => {
    page(31)
    expect(await screen.findByRole('heading', { name: 'First frost of the winter' })).toBeInTheDocument()
    expect(screen.getByText(/^Written/)).toHaveTextContent(/^Written .*05:33$/)
    expect(screen.queryByText(/Checked against its source/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /number check|word to know/ })).not.toBeInTheDocument()
    // Its numbers and its bold word are plain text: pressing them does nothing.
    await userEvent.click(screen.getByText('ceremony'))
    await userEvent.click(screen.getByText(/2 degrees below zero/))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    // The list is still there, with this story's day.
    const list = screen.getByRole('navigation', { name: 'Stories' })
    expect(await within(list).findByRole('link', { name: /First frost/ })).toHaveAttribute('aria-current', 'page')
  })
})

describe('Story on a phone', () => {
  beforeEach(() => {
    paperFetch.mockClear()
    vi.stubGlobal('fetch', paperFetch)
  })

  it('has no list and no checks line, but a tapped mark still shows its note', async () => {
    page(41)
    const number = await screen.findByRole('button', { name: '25, number check' })
    expect(screen.queryByRole('navigation', { name: 'Stories' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Written/)).not.toBeInTheDocument()
    expect(paperFetch.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/issues'))).toBe(false)
    await userEvent.click(number)
    expect(screen.getByRole('complementary', { name: 'Number check' })).toHaveTextContent('25 matches the source article.')
  })
})
