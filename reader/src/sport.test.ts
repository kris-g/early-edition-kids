import { describe, expect, it } from 'vitest'
import type { LogEntry } from './readlog'
import { SportKeeper, countedStories } from './sport'
import { Store, memoryKV } from './storage'
import { issue, sportsView } from './test/fixtures'

const TODAY = '2026-11-16'
const ruled = () => issue({ sports: { path: '/api/sports', label: 'Premier League', matchday: 11, unlock: { needed: 2, min_seconds: { '40': 60, '41': 60, '42': 50, '43': 50 } } } })
const entry = (story_id: number, active_seconds: number, finished: boolean, date = TODAY): LogEntry => ({
  date,
  story_id,
  topic: 'Football',
  title: 'x',
  active_seconds,
  finished,
  ts: 1,
  day: date,
})

describe('what counts toward opening Sport', () => {
  it('counts stories read to the end and for long enough, adding up sittings', () => {
    const log = [
      entry(40, 70, true), // counts
      entry(41, 9, true), // too fast
      entry(42, 30, false), // stopped part way…
      entry(42, 25, true), // …and came back: 55 s in all
      entry(43, 200, false), // never finished
      entry(40, 500, true, '2026-11-15'), // another day's paper
    ]
    expect([...countedStories(ruled(), log)].sort()).toEqual([40, 42])
  })

  it('counts nothing for a paper with no lock', () => {
    expect(countedStories(issue(), [entry(40, 999, true)]).size).toBe(0)
  })
})

describe('the lock', () => {
  const keeper = () => new SportKeeper(new Store(memoryKV(), 'root'))

  it('stays closed until enough stories count, then stays open all day', () => {
    const k = keeper()
    expect(k.lock(TODAY, ruled(), [entry(40, 70, true), entry(41, 9, true)])).toEqual({ open: false, needed: 2, counted: 1 })
    expect(k.lock(TODAY, ruled(), [entry(40, 70, true), entry(41, 61, true)])).toEqual({ open: true, needed: 2, counted: 2 })
    // Open for the rest of the day, whatever the log says now.
    expect(k.lock(TODAY, ruled(), []).open).toBe(true)
    // A new day closes it again.
    expect(k.lock('2026-11-17', ruled(), []).open).toBe(true) // no paper for the 17th yet: open
    expect(k.lock('2026-11-17', { ...ruled(), date: '2026-11-17' }, []).open).toBe(false)
  })

  it('opens on the server’s count from other devices, but only today’s', () => {
    const k = keeper()
    k.put({ ...sportsView(), unlock: { needed: 2, counted: 2, unlocked: true } }, '2026-11-15')
    expect(k.lock(TODAY, ruled(), []).open).toBe(false) // fetched yesterday
    k.put({ ...sportsView(), unlock: { needed: 2, counted: 1, unlocked: false } }, TODAY)
    expect(k.lock(TODAY, ruled(), [])).toEqual({ open: false, needed: 2, counted: 1 })
    k.put({ ...sportsView(), unlock: { needed: 2, counted: 2, unlocked: true } }, TODAY)
    expect(k.lock(TODAY, ruled(), []).open).toBe(true)
  })

  it('is open with no lock, or with no paper today', () => {
    expect(keeper().lock(TODAY, issue(), []).open).toBe(true)
    expect(keeper().lock(TODAY, null, []).open).toBe(true)
  })
})

describe('the closed screen', () => {
  it('says how many, how far, and leads to the next story, with no scores', async () => {
    const { sportClosedHtml } = await import('./sportviews')
    document.body.innerHTML = sportClosedHtml({ open: false, needed: 3, counted: 2 }, 4)
    expect(document.querySelector('h2')!.textContent).toBe('Sport opens after reading 3 of today’s stories')
    expect(document.querySelectorAll('.pips i')).toHaveLength(3)
    expect(document.querySelectorAll('.pips i.on')).toHaveLength(2)
    expect(document.querySelector('.tally')!.textContent).toBe('1 more to go')
    expect(document.querySelector('.btn.go')!.getAttribute('data-go')).toBe('4')
    // Everything read, but too quickly: read them again, from the first story.
    document.body.innerHTML = sportClosedHtml({ open: false, needed: 3, counted: 2 }, null)
    expect(document.body.textContent).toContain('Read 1 of them again, all the way through, to open it.')
    expect(document.querySelector('.btn.go')!.getAttribute('data-go')).toBe('0')
    expect(document.body.textContent).not.toMatch(/\d\s*–\s*\d/)
  })
})
