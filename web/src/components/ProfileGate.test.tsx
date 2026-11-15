import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { API_ROOT, setApiRoot } from '../api/client'
import type { ProfilesView } from '../api/types'
import { LAST_PROFILE_KEY, SINGLE, setCurrentProfile } from '../lib/profile'
import { jsonResponse } from '../test/fixtures'

const TWO: ProfilesView = {
  profiles: [
    { id: 'older', title: 'Early Edition' },
    { id: 'younger', title: 'Little Edition' },
  ],
  root: 'older',
  login: false,
}
const ONE: ProfilesView = { profiles: [{ id: 'default', title: 'Early Edition' }], root: 'default', login: false }

const fetchMock = vi.fn<typeof fetch>()
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

function serve(view: ProfilesView | null) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/dashboard/profiles') return view ? jsonResponse(view) : jsonResponse({ error: 'Not found' }, 404)
    return jsonResponse({ error: 'Not in this test' }, 500)
  })
}

function start(path: string) {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  setCurrentProfile(SINGLE)
  setApiRoot(API_ROOT)
})

describe('profiles in the app', () => {
  it('with one child: no switcher, and the same addresses as always', async () => {
    serve(ONE)
    start('/dashboard/reading')
    await waitFor(() => expect(urls()).toContain('/api/dashboard/reading?days=14'))
    expect(window.location.pathname).toBe('/dashboard/reading')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(urls().some((u) => u.includes('/p/'))).toBe(false)
  })

  it('with an older server: the single-child app', async () => {
    serve(null)
    start('/dashboard/reading')
    await waitFor(() => expect(urls()).toContain('/api/dashboard/reading?days=14'))
    expect(window.location.pathname).toBe('/dashboard/reading')
  })

  it('with two children: opens the first, and switches with the header control', async () => {
    serve(TWO)
    start('/dashboard/reading')
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/p/older/reading'))
    await waitFor(() => expect(urls()).toContain('/api/dashboard/p/older/reading?days=14'))
    const [select] = screen.getAllByRole('combobox')
    expect(select).toHaveValue('older')
    await userEvent.selectOptions(select, 'younger')
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/p/younger/reading'))
    await waitFor(() => expect(urls()).toContain('/api/dashboard/p/younger/reading?days=14'))
    expect(localStorage.getItem(LAST_PROFILE_KEY)).toBe('younger')
    // Back goes to the other child's page.
    await act(async () => {
      window.history.back()
      await new Promise((r) => setTimeout(r, 50))
    })
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveValue('older'))
  })

  it('opens /dashboard/ on the child used last', async () => {
    localStorage.setItem(LAST_PROFILE_KEY, 'younger')
    serve(TWO)
    start('/dashboard/')
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard/p/younger/'))
    await waitFor(() => expect(urls()).toContain('/api/dashboard/p/younger/summary'))
  })
})
