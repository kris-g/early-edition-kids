import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getIssue, joinMount, mountUrl, postEvents } from './api'
import { issue } from './test/fixtures'

afterEach(() => vi.unstubAllGlobals())

describe('talking to the home server', () => {
  it('works relative to the mount the reader was opened from', () => {
    expect(mountUrl('http://h:8080/read/').toString()).toBe('http://h:8080/')
    expect(mountUrl('http://h:8080/p/younger/read/').toString()).toBe('http://h:8080/p/younger/')
    expect(joinMount('/issues/2026-11-16/v1/1.jpg', 'http://h:8080/p/younger/read/')).toBe('http://h:8080/p/younger/issues/2026-11-16/v1/1.jpg')
    expect(joinMount('/api/issue/today', 'http://h:8080/read/')).toBe('http://h:8080/api/issue/today')
  })

  it('says why a request failed: not there, unreachable, or the server', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      if (url.endsWith('today')) return new Response(JSON.stringify(issue()), { status: 200 })
      if (url.endsWith('2026-11-14')) return new Response('{"detail":"no"}', { status: 404 })
      if (url.endsWith('2026-11-13')) throw new TypeError('Load failed')
      return new Response('oops', { status: 500 })
    })
    expect((await getIssue()).date).toBe('2026-11-16')
    await expect(getIssue('2026-11-14')).rejects.toMatchObject({ kind: 'not_found' })
    await expect(getIssue('2026-11-13')).rejects.toMatchObject({ kind: 'network' })
    await expect(getIssue('2026-11-12')).rejects.toBeInstanceOf(ApiError)
    expect(urls[0]).toMatch(/\/api\/issue\/today$/)
  })

  it('posts events with the paper they belong to', async () => {
    let sent: { body: string; headers: Record<string, string> } | null = null
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = { body: String(init.body), headers: init.headers as Record<string, string> }
      return new Response('{"accepted":["a"]}', { status: 200 })
    })
    const r = await postEvents({ device_id: 'd', events: [], profile: 'older', profile_root: true })
    expect(r.accepted).toEqual(['a'])
    expect(JSON.parse(sent!.body)).toEqual({ device_id: 'd', events: [], profile: 'older', profile_root: true })
    expect(sent!.headers['Content-Type']).toBe('application/json')
  })
})
