import { describe, expect, it } from 'vitest'
import { Tracker } from './tracker'

describe('the reading clock', () => {
  it('counts time between interactions, not while paused, and caps long gaps', () => {
    let now = 0
    const t = new Tracker(() => now, 300)
    now = 20
    t.page(1, 3)
    now = 50
    t.pause() // the iPad sleeps
    now = 5000
    t.resume()
    now = 5010
    t.page(2, 3)
    now = 6000 // left on the table
    const r = t.result()
    expect(r.active_seconds).toBe(20 + 30 + 10 + 300)
    expect(r).toMatchObject({ pages_total: 3, max_page: 2, finished: false })
  })

  it('counts the last page shown as the end, like the Kindle', () => {
    const t = new Tracker(() => 0)
    expect(t.page(1, 2)).toBe(false)
    expect(t.page(2, 2)).toBe(true)
    expect(t.result()).toMatchObject({ pages_total: 2, max_page: 2, finished: true })
  })

  it('keeps reaching the end when the pages are re-laid', () => {
    const t = new Tracker(() => 0)
    t.page(3, 3)
    t.markEnd(3)
    expect(t.result(2)).toMatchObject({ pages_total: 2, max_page: 2, finished: true })
  })

  it('never reports an unfinished story as finished (the long paper)', () => {
    const t = new Tracker(() => 0)
    expect(t.result(2)).toMatchObject({ pages_total: 2, max_page: 1, finished: false })
    t.markEnd(2)
    expect(t.result(2)).toMatchObject({ max_page: 2, finished: true })
  })

  it('carries on from a saved state', () => {
    let now = 0
    const t = new Tracker(() => now, 300, { active: 40, maxPage: 2, pagesTotal: 2, reachedEnd: false })
    now = 5
    expect(t.result()).toMatchObject({ active_seconds: 45, finished: true })
  })
})
