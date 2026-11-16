import { describe, expect, it } from 'vitest'
import { myWeek } from './readlog'
import { issue } from './test/fixtures'
import { backIssuesHtml, finishedHtml, frontHtml, myWeekHtml, nextUnread, waitingHtml, type ViewCtx } from './views'

const ctx = (read: number[] = []): ViewCtx => {
  const i = issue()
  return { issue: i, read: new Set(read), photo: (s) => (s.image ? `http://h/${s.image.path}` : null) }
}
const dom = (html: string) => {
  const d = document.createElement('div')
  d.innerHTML = html
  return d
}

describe('the screens', () => {
  it('leads the front page with the first unread story, escapes text and has no links out', () => {
    const d = dom(frontHtml(ctx([40]), 'check'))
    expect(d.querySelector('.lead h2')!.textContent).toBe('Story <2>')
    expect(d.querySelector('.dateline')!.textContent).toContain('Monday 16 November 2026')
    expect(d.querySelector('.dateline')!.textContent).toContain('No. 7')
    expect(d.querySelector('.tally')!.textContent).toContain('1 of 4 read')
    expect(d.querySelectorAll('.row').length).toBe(3)
    expect(d.querySelectorAll('.row.read').length).toBe(1)
    expect(d.querySelector('.lead-photo img')!.getAttribute('alt')).toBe('Alt 2')
    // The story with no photo shows its topic icon instead.
    expect(d.querySelector('[data-go="2"] .thumb img')).toBeNull()
    expect(d.querySelectorAll('a').length).toBe(0)
    expect(d.innerHTML).not.toContain('<2>')
  })

  it('hands on to the next unread story, and ends the paper in yellow', () => {
    const stories = issue().stories
    expect(nextUnread(stories, new Set([41]), 1)?.id).toBe(42)
    expect(nextUnread(stories, new Set([42, 43]), 3)?.id).toBe(40)
    expect(nextUnread(stories, new Set([40, 41, 42, 43]), 0)).toBeNull()
    const next = dom(finishedHtml(ctx([40]), 0, true))
    expect(next.querySelector('.next-story')!.textContent).toContain('Story <2>')
    const done = dom(finishedHtml(ctx([40, 41, 42, 43]), 3, false))
    expect(done.querySelector('.finished.paper-done h2')!.textContent).toBe('Paper finished!')
    expect(done.querySelector('.stamp text')!.textContent).toBe('16 NOV')
  })

  it('lists back issues with how much was read, and says when there are none', () => {
    const i = issue({ date: '2026-11-15', number: 6 })
    const d = dom(backIssuesHtml([{ date: '2026-11-15', issue: i, read: new Set([40, 41]), photo: null }]))
    expect(d.querySelector('.issue-day')!.textContent).toBe('Sunday 15 November · No. 6')
    expect(d.querySelector('.issue-row strong')!.textContent).toBe('Story <1>')
    expect(d.querySelector('.issue-row .tally')!.textContent).toContain('2 of 4 read')
    expect(dom(backIssuesHtml([])).textContent).toContain('no back issues yet')
    expect(dom(backIssuesHtml(null)).textContent).toContain('Fetching')
  })

  it('shows My week as counts and a streak, never a score', () => {
    const d = dom(myWeekHtml(myWeek([], '2026-11-17')))
    expect(d.querySelectorAll('.days .day').length).toBe(7)
    expect(d.textContent).toContain('Nothing read yet this week')
    expect(d.textContent).not.toMatch(/score|missed|%/i)
  })

  it('says calmly when the paper is not ready or the news cannot be reached', () => {
    const wait = dom(waitingHtml('not_ready', 'Early Edition', '2026-11-16', false))
    expect(wait.querySelector('h2')!.textContent).toBe('Today’s paper isn’t ready yet')
    expect(wait.querySelector('[data-act="yesterday"]')).not.toBeNull()
    const off = dom(waitingHtml('offline', 'Early Edition', '2026-11-16', true))
    expect(off.querySelector('h2')!.textContent).toBe('Can’t reach the news right now')
    expect(off.querySelector('button[disabled]')!.textContent).toContain('Checking')
  })
})
