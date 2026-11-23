// The reader talks only to the home server, and only relative to where it was opened: the page is
// <mount>/read/, so the API is ../api/... and story files are the payload's paths joined onto the
// mount. One build works for the root profile and every /p/<id>/ mount.

import type { Issue, ReaderSettings, SportsView } from './types'

export type FailKind = 'not_found' | 'network' | 'server' | 'conflict'

export class ApiError extends Error {
  readonly kind: FailKind
  readonly status: number
  constructor(kind: FailKind, status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

const TIMEOUT_MS = 15_000

/** The mount the reader is under, as a URL ending in "/": http://server:8080/p/younger/ */
export function mountUrl(href: string = location.href): URL {
  return new URL('../', href)
}

/** A server-relative path from the payload ("/issues/...") joined onto the mount. */
export function joinMount(path: string, href: string = location.href): string {
  return new URL(path.replace(/^\/+/, ''), mountUrl(href)).toString()
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    return await fetch(joinMount(path), {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      ...init,
      signal: ctl.signal,
    })
  } catch (err) {
    throw new ApiError('network', 0, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}

function fail(res: Response): ApiError {
  if (res.status === 404) return new ApiError('not_found', 404, 'not found')
  if (res.status === 409) return new ApiError('conflict', 409, 'a different paper')
  return new ApiError('server', res.status, `the server answered ${res.status}`)
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await call(path, init)
  if (!res.ok) throw fail(res)
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('server', res.status, 'not JSON')
  }
}

export function isIssue(v: unknown): v is Issue {
  const i = v as Issue
  return Boolean(i) && typeof i.date === 'string' && typeof i.version === 'number' && Array.isArray(i.stories)
}

/** Today's paper (`date` omitted) or one day's. A 404 means it isn't there (yet). */
export async function getIssue(date?: string): Promise<Issue> {
  const data = await json<unknown>(date ? `/api/issue/${encodeURIComponent(date)}` : '/api/issue/today')
  if (!isIssue(data)) throw new ApiError('server', 200, 'not an issue')
  return data
}

export async function getSettings(): Promise<ReaderSettings> {
  return json<ReaderSettings>('/api/reader')
}

export function isSportsView(v: unknown): v is SportsView {
  const s = v as SportsView
  return Boolean(s) && typeof s.updated_at === 'string' && Array.isArray(s.teams)
}

/** The Sport page, at the path the issue gave. A 404 means it is off or withdrawn. */
export async function getSports(path: string): Promise<SportsView> {
  const data = await json<unknown>(path)
  if (!isSportsView(data)) throw new ApiError('server', 200, 'not a Sport page')
  return data
}

export async function getStoryHtml(path: string): Promise<string> {
  const res = await call(path)
  if (!res.ok) throw fail(res)
  return res.text()
}

export interface EventsBody {
  device_id: string
  events: unknown[]
  profile?: string
  profile_root?: boolean
}

export async function postEvents(body: EventsBody, keepalive = false): Promise<{ accepted: string[] }> {
  const data = await json<{ accepted?: unknown }>('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  })
  if (!Array.isArray(data.accepted)) throw new ApiError('server', 200, 'no accepted list')
  return { accepted: data.accepted.filter((x): x is string => typeof x === 'string') }
}
