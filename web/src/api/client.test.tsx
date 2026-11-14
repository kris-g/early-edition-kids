import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../App'
import { RELOAD_KEY, isSignedOut, resetSignedOut, signedOutDeps } from '../lib/signedOut'
import { jsonResponse } from '../test/fixtures'
import { ApiError, SIGNED_OUT_MESSAGE } from './client'
import { api } from './endpoints'

const fetchMock = vi.fn<typeof fetch>()
const reload = vi.fn()
let now = 1_800_000_000_000

/** What fetch(..., {redirect: 'manual'}) gives back when Authelia redirects. */
function autheliaRedirect(): Response {
  return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  reload.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  signedOutDeps.reload = reload
  signedOutDeps.now = () => now
  resetSignedOut()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function sent(call = 0) {
  const init = fetchMock.mock.calls[call][1] ?? {}
  return { url: fetchMock.mock.calls[call][0], init, headers: (init.headers ?? {}) as Record<string, string> }
}

describe('fetch wrapper', () => {
  it('sends GETs same-origin with redirect: manual and no X-Early-Edition header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))
    await api.topics()
    const { url, init, headers } = sent()
    expect(url).toBe('/api/dashboard/topics')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(init.redirect).toBe('manual')
    expect(headers['X-Early-Edition']).toBeUndefined()
  })

  it('adds X-Early-Edition: 1 and a JSON body on non-GET requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ name: 'Space' }))
    await api.setTopicMode('Animals and nature', 'pin')
    const { url, init, headers } = sent()
    expect(url).toBe('/api/dashboard/topics/Animals%20and%20nature')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(headers['X-Early-Edition']).toBe('1')
    expect(headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ mode: 'pin' }))
  })

  it('adds X-Early-Edition on a POST with no body too', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await api.hide(7)
    expect(sent().headers['X-Early-Edition']).toBe('1')
  })

  it('surfaces the {error} message in sentence case', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'no such topic' }, 404))
    const err = await api.setTopicMode('Nope', null).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(404)
    expect((err as ApiError).message).toBe('No such topic')
    expect(reload).not.toHaveBeenCalled()
  })

  it('turns a network failure into a readable error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.summary()).rejects.toThrow(/Could not reach the server/)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('expired Authelia session', () => {
  it('reloads the page once on an opaque redirect', async () => {
    fetchMock.mockResolvedValueOnce(autheliaRedirect())
    await expect(api.summary()).rejects.toMatchObject({ status: 401, message: SIGNED_OUT_MESSAGE })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe(String(now))
    expect(isSignedOut()).toBe(false)
  })

  it('treats a 401 the same way', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorised' }, 401))
    await expect(api.topics()).rejects.toMatchObject({ status: 401 })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload again within 30 seconds, and shows the signed-out message instead', async () => {
    fetchMock.mockResolvedValue(autheliaRedirect())
    await api.summary().catch(() => {})
    expect(reload).toHaveBeenCalledTimes(1)

    now += 29_000 // the reload happened and came straight back still signed out
    await api.summary().catch(() => {})
    expect(reload).toHaveBeenCalledTimes(1)
    expect(isSignedOut()).toBe(true)
  })

  it('reloads again once the 30 seconds have passed', async () => {
    fetchMock.mockResolvedValue(autheliaRedirect())
    await api.summary().catch(() => {})
    now += 31_000
    await api.summary().catch(() => {})
    expect(reload).toHaveBeenCalledTimes(2)
  })
})

describe('signed-out message in the app', () => {
  it('shows a plain message with a reload button instead of looping', async () => {
    sessionStorage.setItem(RELOAD_KEY, String(now - 5_000)) // reloaded 5 s ago
    fetchMock.mockResolvedValue(autheliaRedirect())
    render(
      <MemoryRouter initialEntries={['/topics']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByText('You’re signed out. Reload to sign in again.', { selector: 'p' })).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull()
  })

  it('has no login page: the app loads straight into the dashboard', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    render(
      <MemoryRouter initialEntries={['/topics']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Topics' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
  })
})
