import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderApp, ageClass, pageCount } from './app'
import { memoryKV, type KV } from './storage'
import { STORY_HTML, issue, sportsView } from './test/fixtures'
import type { Issue } from './types'

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>
let posted: { device_id: string; events: { type: string; story_id: number | null; payload: Record<string, unknown> }[]; profile?: string }[]

function serve(today: Issue | 404 | 'down', extra: Route = () => new Response('{}', { status: 404 })) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (today === 'down') throw new TypeError('Load failed')
    if (url.endsWith('/api/reader')) return new Response(JSON.stringify({ profile: 'older', profile_root: true, title: 'Early Edition', mode: 'pages', age: 6 }))
    if (url.endsWith('/api/issue/today')) return today === 404 ? new Response('{}', { status: 404 }) : new Response(JSON.stringify(today))
    if (url.endsWith('.html')) return new Response(STORY_HTML)
    if (url.endsWith('/api/events')) {
      const body = JSON.parse(String(init!.body))
      posted.push(body)
      return new Response(JSON.stringify({ accepted: body.events.map((e: { client_event_id: string }) => e.client_event_id) }))
    }
    return extra(url, init)
  })
}

function start(kv: KV = memoryKV()) {
  document.body.innerHTML = '<div class="app" id="app"><main class="stage" id="stage"></main></div>'
  const app = new ReaderApp({ app: document.getElementById('app')!, stage: document.getElementById('stage')!, kv, pathname: '/read/' })
  app.start()
  return app
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}
const stage = () => document.getElementById('stage')!
const click = (sel: string) => (stage().querySelector(sel) as HTMLElement).click()

beforeEach(() => {
  posted = []
  vi.setSystemTime(new Date('2026-11-16T07:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the reader', () => {
  it('sizes type by age band', () => {
    expect([5, 6, 7, 8, 9, 12].map(ageClass)).toEqual(['age-young', 'age-young', 'age-mid', 'age-mid', 'age-older', 'age-older'])
  })

  it('shows today’s paper and records the download and the front page', async () => {
    serve(issue())
    const app = start()
    await settle()
    expect(app.screen).toBe('front')
    expect(stage().querySelector('.mast h1')!.textContent).toBe('Early Edition')
    expect(document.body.classList.contains('age-young')).toBe(true)
    await app.uploader.flush()
    const events = posted.flatMap((p) => p.events)
    expect(events.map((e) => e.type)).toEqual(['issue_downloaded', 'list_shown'])
    expect(posted[0]).toMatchObject({ profile: 'older', profile_root: true })
  })

  it('records a story read in pages as the Kindle does, and keeps it in My week', async () => {
    serve(issue())
    const app = start()
    await settle()
    click('.btn.go')
    await settle()
    expect(app.screen).toBe('story')
    expect(stage().querySelector('.place')!.textContent).toContain('Story 1 of 4')
    expect(stage().querySelector('.box.word')!.textContent).toContain('Booster')
    click('[data-turn="1"]') // the only page: Finish
    expect(stage().querySelector('.finished h2')!.textContent).toBe('Story finished!')
    click('[data-go="front"]')
    await app.uploader.flush()
    const events = posted.flatMap((p) => p.events)
    const closed = events.find((e) => e.type === 'story_closed')!
    expect(closed.story_id).toBe(40)
    expect(closed.payload).toMatchObject({ pages_total: 1, max_page: 1, finished: true })
    expect(stage().querySelector('.tally')!.textContent).toContain('1 of 4 read')
    click('[data-act="myweek"]')
    expect(stage().querySelector('.stat .num')!.textContent).toBe('1')
  })

  it('says today’s paper isn’t ready on a 404, and offers yesterday’s', async () => {
    serve(404)
    const app = start()
    await settle()
    expect(app.screen).toBe('waiting')
    expect(stage().querySelector('h2')!.textContent).toBe('Today’s paper isn’t ready yet')
  })

  it('keeps showing the last paper when the server can’t be reached', async () => {
    const kv = memoryKV()
    serve(issue())
    start(kv)
    await settle()
    serve('down')
    const app = start(kv)
    expect(app.screen).toBe('front')
    await settle()
    expect(app.screen).toBe('front')
    expect(stage().querySelector('.dateline .dl-btn')!.textContent).toContain('Can’t reach the news')
    // Nothing kept and nothing reachable: a calm message.
    const fresh = start(memoryKV())
    await settle()
    expect(fresh.screen).toBe('waiting')
    expect(stage().querySelector('h2')!.textContent).toBe('Can’t reach the news right now')
  })

  it('closes a story left open when the app was killed', async () => {
    const kv = memoryKV()
    serve(issue())
    const app = start(kv)
    await settle()
    click('.btn.go')
    // The app is killed here: no Front page, no close.
    serve(issue())
    const again = start(kv)
    await settle()
    await again.uploader.flush()
    const types = posted.flatMap((p) => p.events).map((e) => e.type)
    expect(types).toContain('story_opened')
    expect(types).toContain('story_closed')
    expect(app).toBeTruthy()
  })
})

describe('text size and page colour', () => {
  it('opens from the Aa button on a story, and keeps what is chosen for next time', async () => {
    const kv = memoryKV()
    serve(issue())
    const app = start(kv)
    await settle()
    expect(stage().querySelector('.look-btn')).toBeNull() // only on a story
    click('.btn.go')
    click('.look-btn')
    expect(app.lookOpen).toBe(true)
    expect(stage().querySelector('.look-btn')!.getAttribute('aria-expanded')).toBe('true')
    click('[data-look="bigger"]')
    click('[data-look="theme:sepia"]')
    expect(document.documentElement.dataset.theme).toBe('sepia')
    expect(document.documentElement.style.getPropertyValue('--fs')).toBe('1.1')
    expect(stage().querySelector('[data-look="theme:sepia"]')!.getAttribute('aria-pressed')).toBe('true')
    // A tap on the page puts the panel away without turning it.
    click('#pager')
    expect(app.lookOpen).toBe(false)
    expect(stage().querySelector('#look')).toBeNull()
    expect(stage().querySelector('.finished')).toBeNull()

    document.documentElement.removeAttribute('data-theme')
    serve(issue())
    const again = start(kv)
    expect(again.look).toEqual({ theme: 'sepia', size: 3 })
    expect(document.documentElement.dataset.theme).toBe('sepia')
  })

  it('stops at the smallest and biggest sizes', async () => {
    serve(issue())
    const app = start()
    await settle()
    click('.btn.go')
    click('.look-btn')
    for (let k = 0; k < 10; k++) click('[data-look="smaller"]')
    expect(app.look.size).toBe(0)
    expect((stage().querySelector('[data-look="smaller"]') as HTMLButtonElement).disabled).toBe(true)
    click('[data-look="done"]')
    expect(app.lookOpen).toBe(false)
    expect(stage().querySelector('#look')).toBeNull()
    click('.look-btn')
    click('[data-go="front"]')
    expect(app.lookOpen).toBe(false)
  })
})

describe('pageCount', () => {
  const rect = (left: number, right: number) => ({ left, right, width: right - left, height: 20, top: 0, bottom: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect
  function flowWith(scrollWidth: number, rights: number[]) {
    const flow = document.createElement('div')
    Object.defineProperty(flow, 'scrollWidth', { value: scrollWidth })
    flow.getBoundingClientRect = () => rect(0, 800)
    for (const r of rights) {
      const p = document.createElement('p')
      p.getBoundingClientRect = () => rect(r - 700, r)
      flow.appendChild(p)
    }
    return flow
  }

  it('counts the columns blocks run into even when scrollWidth leaves them out (Safari)', () => {
    expect(pageCount(flowWith(800, [760, 760, 1560]), 800)).toBe(2)
  })

  it('agrees with scrollWidth when it does include them (Chrome)', () => {
    expect(pageCount(flowWith(1600, [760, 1560]), 800)).toBe(2)
    expect(pageCount(flowWith(800, [760]), 800)).toBe(1)
  })
})

describe('the Sport page', () => {
  const RULE = { needed: 2, min_seconds: { '40': 60, '41': 60, '42': 50, '43': 50 } }
  const withSport = (unlock: typeof RULE | null = RULE) => issue({ sports: { path: '/api/sports', label: 'Premier League', matchday: 11, unlock } })
  const sportsRoute = (view = sportsView()): Route => (url) => (url.endsWith('/api/sports') ? new Response(JSON.stringify(view)) : new Response('{}', { status: 404 }))
  const later = (seconds: number) => vi.setSystemTime(new Date(Date.now() + seconds * 1000))
  const strip = () => stage().querySelector('.sport-strip')
  /** Read story `i` from the front page for `seconds`, to the end, and come back. */
  async function read(i: number, seconds: number) {
    click(`[data-go="${i}"]`)
    later(seconds)
    click('[data-turn="1"]')
    click('[data-go="front"]')
    await settle()
  }

  it('is closed until enough stories are read properly, and a story read too fast doesn’t count', async () => {
    serve(withSport(), sportsRoute())
    const app = start()
    await settle()
    expect(strip()!.classList.contains('closed')).toBe(true)
    expect(strip()!.textContent).toContain('Opens after reading 2 of today’s stories · 2 more to go')
    expect(strip()!.textContent).not.toMatch(/\d\s*–\s*\d/) // never a score

    await read(0, 70) // counts
    expect(strip()!.textContent).toContain('1 more to go')
    await read(1, 5) // finished, but paged through
    expect(strip()!.textContent).toContain('1 more to go')
    expect(stage().querySelector('.tally')!.textContent).toContain('2 of 4 read') // still read everywhere else

    // The closed strip leads to the next story to read, never to Sport.
    click('.sport-strip button')
    expect(app.screen).toBe('story')
    click('[data-go="front"]')
    await settle()

    await read(2, 55)
    expect(strip()!.classList.contains('closed')).toBe(false)
    expect(strip()!.textContent).toContain('Premier League · Matchday 11')
  })

  it('shows the matches, the table, the next fixtures and a match, and records each look', async () => {
    serve(withSport(null), sportsRoute())
    const app = start()
    await settle()
    click('.sport-strip button')
    await settle()
    expect(app.screen).toBe('sport')
    expect(stage().querySelector('.runhead .place')!.textContent).toBe('Results to Sunday 15 November')
    const rows = [...stage().querySelectorAll('.match')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('2 – 0')
    expect(rows[0].classList.contains('fav')).toBe(true)
    expect(rows[0].textContent).toContain('Wirtz 13\' (pen)')
    expect(rows[1].textContent).toContain('8:00pm')
    expect(rows[1].tagName).toBe('DIV') // not played: nothing to open

    later(30)
    click('[data-sport="tab:table"]')
    expect(stage().querySelectorAll('.league tbody tr')).toHaveLength(3)
    expect(stage().querySelector('.league tr.fav')!.textContent).toContain('Liverpool')
    expect(stage().querySelector('.league tr.cut')!.textContent).toContain('Liverpool')
    later(1) // a flick: not recorded
    click('[data-sport="tab:next"]')
    expect(stage().querySelector('.sport-title')!.textContent).toBe('Matchday 12')
    later(10)
    click('[data-sport="tab:matches"]')
    click('[data-sport="match:2645301"]')
    expect(stage().querySelector('.m-big')!.textContent).toBe('2 – 0')
    expect(stage().textContent).toContain('Leny <Yoro>') // escaped, shown as text
    expect(stage().querySelector('yoro')).toBeNull()
    expect(stage().textContent).toContain('Went off injured')
    expect(stage().textContent).toContain('Out injured')
    expect(stage().textContent).toContain('Bradley')
    later(45)
    click('.runhead [data-sport="tab:matches"]') // the way back from a match
    expect(stage().querySelectorAll('.match')).toHaveLength(2)
    click('[data-go="front"]')
    expect(app.screen).toBe('front')
    await app.uploader.flush()

    const looks = posted.flatMap((p) => p.events).filter((e) => e.type === 'sport_viewed')
    expect(looks.map((e) => [e.story_id, e.payload])).toEqual([
      [null, { page: 'matches', match_id: null, matchday: 11, active_seconds: 30 }],
      [null, { page: 'next', match_id: null, matchday: 12, active_seconds: 10 }],
      [null, { page: 'match', match_id: '2645301', matchday: 11, active_seconds: 45 }],
    ])
  })

  it('opens on the server’s count when the reading was done on another device', async () => {
    serve(withSport(), sportsRoute(sportsView({ unlock: { needed: 2, counted: 2, unlocked: true } })))
    start()
    await settle()
    expect(strip()!.classList.contains('closed')).toBe(false)
  })

  it('has no strip when the paper has no Sport page, and forgets a page the server took down', async () => {
    serve(issue())
    start()
    await settle()
    expect(strip()).toBeNull()

    const kv = memoryKV()
    serve(withSport(null), sportsRoute())
    const app = start(kv)
    await settle()
    expect(app.sport.view()).not.toBeNull()
    serve(withSport(null))
    await app.checkForNews(false)
    await settle()
    expect(app.sport.view()).toBeNull()
    click('.sport-strip button')
    expect(stage().textContent).toContain('The scores aren’t here yet.')
  })
})

describe('the Sport strip', () => {
  it('opens when a parent turns the lock off, with the same paper', async () => {
    const kv = memoryKV()
    const lockOf = (unlock: { needed: number; min_seconds: Record<string, number> } | null) =>
      issue({ sports: { path: '/api/sports', label: 'Premier League', matchday: 11, unlock } })
    const sport: Route = (url) => (url.endsWith('/api/sports') ? new Response(JSON.stringify(sportsView())) : new Response('{}', { status: 404 }))
    serve(lockOf({ needed: 2, min_seconds: { '40': 60 } }), sport)
    start(kv)
    await settle()
    expect(stage().querySelector('.sport-strip')!.classList.contains('closed')).toBe(true)
    // Opened again later: the kept paper shows first, then the server's copy without the lock.
    serve(lockOf(null), sport)
    start(kv)
    await settle()
    expect(stage().querySelector('.sport-strip')!.classList.contains('closed')).toBe(false)
  })
})
