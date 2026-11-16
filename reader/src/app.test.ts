import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReaderApp, ageClass, pageCount } from './app'
import { memoryKV, type KV } from './storage'
import { STORY_HTML, issue } from './test/fixtures'
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
