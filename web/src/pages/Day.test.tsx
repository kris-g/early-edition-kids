import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { DayView, IssueView } from '../api/types'
import { card, stats } from '../test/fixtures'
import { PaperOfDay, ReadThatDay } from './Day'

const read = { opened: true, reached_end: true, active_seconds: 200 }

function paper(date: string, stories: IssueView['stories']): IssueView {
  return {
    date,
    version: 1,
    fallback: false,
    created_at: `${date}T05:31:00Z`,
    downloaded_by: [],
    read_count: stories.filter((s) => s.stats.reached_end).length,
    stories,
  }
}

const sunday = card({ id: 67, date: '2026-11-15', title: 'Ian Rush backs young Red', stats: stats({ ...read, read_on: '2026-11-15' }) })
const thursday = card({ id: 51, date: '2026-11-12', title: 'Wales boss praises Koumas', stats: stats({ ...read, read_on: '2026-11-15' }) })
const friday = card({ id: 53, date: '2026-11-13', title: 'Harry Kane breaks England record', stats: stats({ ...read, read_on: '2026-11-15' }) })

const day: DayView = {
  date: '2026-11-15',
  read: 3,
  minutes: 10,
  reads: [sunday, thursday, friday].map((story, i) => ({
    story,
    at: `2026-11-15T1${i}:00:00Z`,
    active_seconds: 200,
    finished: true,
  })),
  paper: paper('2026-11-15', [sunday]),
  sport: null,
  sport_unlock: null,
}

const show = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('Day', () => {
  it('splits what he read into today’s paper and catching up, by paper', () => {
    show(<ReadThatDay day={day} today="2026-11-15" />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('1 from today’s paper · 2 catching up')).toBeInTheDocument()
    const own = screen.getByRole('region', { name: 'From today’s paper' })
    expect(within(own).getByText('Ian Rush backs young Red')).toBeInTheDocument()
    const thu = screen.getByRole('region', { name: 'Catching up · Thu 12 Nov paper' })
    expect(within(thu).getByText('Wales boss praises Koumas')).toBeInTheDocument()
    expect(within(thu).getByRole('link', { name: 'Open paper' })).toHaveAttribute('href', '/day/2026-11-12?view=paper')
    expect(screen.getByRole('region', { name: 'Catching up · Fri 13 Nov paper' })).toBeInTheDocument()
  })

  it('on a day with nothing read, says its paper was read later', () => {
    const fri: DayView = { date: '2026-11-13', read: 0, minutes: 0, reads: [], paper: paper('2026-11-13', [friday]), sport: null, sport_unlock: null }
    show(<ReadThatDay day={fri} today="2026-11-15" onShowPaper={() => {}} />)
    expect(screen.getByText(/1 story from this day’s paper was read later/)).toBeInTheDocument()
  })

  it('shows the day’s time on Sport, when it opened, and each page', () => {
    const sport: DayView['sport'] = {
      date: '2026-11-15',
      views: 3,
      seconds: 330,
      pages: [
        { page: 'match', match_id: '2645301', match: 'Liverpool 4–0 Man Utd', views: 2, seconds: 200 },
        { page: 'table', match_id: null, match: null, views: 1, seconds: 130 },
      ],
    }
    const sport_unlock: DayView['sport_unlock'] = { needed: 1, total: 1, counted: 1, unlocked: true, unlocked_at: '2026-11-15T10:04:00Z', stories: [] }
    show(<ReadThatDay day={{ ...day, sport, sport_unlock }} today="2026-11-15" />)
    const card = screen.getByRole('region', { name: 'Sport' })
    expect(card).toHaveTextContent('5 min 30 s · 3 looks · opened at 10:04')
    expect(within(card).getByText('Liverpool 4–0 Man Utd')).toBeInTheDocument()
    expect(within(card).getByText('3 min 20 s')).toBeInTheDocument()
    expect(within(card).getByText('Table')).toBeInTheDocument()
  })

  it('shows Sport on a day with nothing read, and no card on a day without Sport', () => {
    const sport: DayView['sport'] = { date: '2026-11-13', views: 1, seconds: 45, pages: [{ page: 'next', match_id: null, match: null, views: 1, seconds: 45 }] }
    const fri: DayView = { date: '2026-11-13', read: 0, minutes: 0, reads: [], paper: null, sport, sport_unlock: null }
    const { unmount } = show(<ReadThatDay day={fri} today="2026-11-15" />)
    expect(screen.getByRole('region', { name: 'Sport' })).toHaveTextContent('45 s · 1 look')
    expect(screen.getByText('Fixtures')).toBeInTheDocument()
    unmount()
    show(<ReadThatDay day={day} today="2026-11-15" />)
    expect(screen.queryByRole('region', { name: 'Sport' })).not.toBeInTheDocument()
  })

  it('says which stories were read too fast, and how many', () => {
    const quick = card({ id: 68, date: '2026-11-15', title: 'Rivers are getting cleaner', stats: stats({ ...read, active_seconds: 9, too_fast: true, read_on: '2026-11-15' }) })
    const reads = [...day.reads, { story: quick, at: '2026-11-15T13:00:00Z', active_seconds: 9, finished: true }]
    show(<ReadThatDay day={{ ...day, read: 4, reads, paper: paper('2026-11-15', [sunday, quick]) }} today="2026-11-15" />)
    expect(screen.getByText(/2 from today’s paper · 2 catching up · 1 read too fast/)).toBeInTheDocument()
    const own = screen.getByRole('region', { name: 'From today’s paper' })
    expect(within(own).getByRole('img', { name: 'Read too fast' })).toBeInTheDocument()
    expect(within(own).getByText(/read too fast/)).toBeInTheDocument()
  })

  it('shows a paper’s stories with the day they were read', () => {
    const fri: DayView = { date: '2026-11-13', read: 0, minutes: 0, reads: [], paper: paper('2026-11-13', [friday]), sport: null, sport_unlock: null }
    show(<PaperOfDay day={fri} onStoryChange={() => {}} />)
    expect(screen.getByText('Read on a later day')).toBeInTheDocument()
    expect(screen.getByText('Read on Sun 15 Nov · 3 min 20 s')).toBeInTheDocument()
  })
})
