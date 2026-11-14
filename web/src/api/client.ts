// A tiny fetch wrapper for the dashboard's JSON API (CONTRACT.md, "Parent dashboard").
//  - no login of its own: Authelia on the edge is the only lock
//  - `redirect: 'manual'`, so an expired Authelia session shows up as an
//    opaque redirect (or a 401) rather than the sign-in page's HTML; the page
//    then reloads once to go through Authelia (see lib/signedOut.ts)
//  - same-origin cookies (Authelia's)
//  - `X-Early-Edition: 1` on every non-GET request (the server's CSRF guard)
//  - `{error}` bodies become ApiError messages

import { handleSignedOut } from '../lib/signedOut'

export const API_ROOT = '/api/dashboard'

export const SIGNED_OUT_MESSAGE = 'You’re signed out. Reload to sign in again.'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type RequestOptions = {
  body?: unknown
  signal?: AbortSignal
}

/** Server messages may start lower-case; the UI uses sentence case. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json()
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>
      if (typeof d.error === 'string' && d.error) return sentence(d.error)
      if (typeof d.detail === 'string' && d.detail) return sentence(d.detail)
    }
  } catch {
    // not JSON
  }
  if (res.status === 403) return 'The server refused that request.'
  if (res.status === 404) return 'Not found.'
  if (res.status === 429) return 'Too many requests. Wait a minute and try again.'
  return `The server returned an error (${res.status}).`
}

/** An Authelia redirect (opaque under redirect: 'manual') or a 401 means the session expired. */
export function isSignedOutResponse(res: Response): boolean {
  return res.type === 'opaqueredirect' || res.status === 401 || (res.status >= 300 && res.status < 400)
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const upper = method.toUpperCase()
  if (upper !== 'GET' && upper !== 'HEAD') headers['X-Early-Edition'] = '1'
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(API_ROOT + path, {
      method: upper,
      credentials: 'same-origin',
      redirect: 'manual',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'Could not reach the server. Check the connection and try again.')
  }

  if (isSignedOutResponse(res)) {
    handleSignedOut()
    throw new ApiError(401, SIGNED_OUT_MESSAGE)
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const get = <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal })
export const post = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>('POST', path, { body, signal })

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
