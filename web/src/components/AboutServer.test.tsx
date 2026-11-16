import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AboutView } from '../api/types'
import { runsOn, uptime } from '../lib/format'
import { jsonResponse } from '../test/fixtures'
import { AboutServer } from './AboutServer'

const about = (over: Partial<AboutView> = {}): AboutView => ({
  version: '0.2.0',
  arch: 'arm64',
  platform: 'linux',
  container: 'docker',
  uptime_seconds: 3 * 86400 + 4 * 3600 + 12 * 60,
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('About this server', () => {
  it('asks the root API, not a child’s, and shows the version, where it runs and for how long', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(about()))
    vi.stubGlobal('fetch', fetchMock)
    render(<AboutServer />)
    const card = screen.getByRole('region', { name: 'About this server' })
    expect(await within(card).findByText('0.2.0')).toBeInTheDocument()
    expect(card).toHaveTextContent('Version0.2.0')
    expect(card).toHaveTextContent('Runs onDocker, arm64')
    expect(card).toHaveTextContent('Running for3 days 4 hours')
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/dashboard/about')
  })

  it('says so when an older server has no such route', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => jsonResponse({ error: 'That could not be found.' }, 404)))
    render(<AboutServer />)
    expect(await screen.findByText(/didn’t say/)).toBeInTheDocument()
  })

  it('names the container when there is one, else the operating system', () => {
    expect(runsOn(about())).toBe('Docker, arm64')
    expect(runsOn(about({ container: 'kubernetes', arch: 'x64' }))).toBe('Kubernetes, x64')
    expect(runsOn(about({ container: null, platform: 'darwin' }))).toBe('macOS, arm64')
    expect(runsOn(about({ container: null, platform: 'freebsd', arch: 'x64' }))).toBe('freebsd, x64')
  })

  it('gives uptime in its two biggest units', () => {
    expect(uptime(0)).toBe('Less than a second')
    expect(uptime(40)).toBe('40 seconds')
    expect(uptime(61)).toBe('1 minute 1 second')
    expect(uptime(3600)).toBe('1 hour')
    expect(uptime(2 * 3600 + 5 * 60 + 9)).toBe('2 hours 5 minutes')
    expect(uptime(86400 + 59)).toBe('1 day')
    expect(uptime(3 * 86400 + 4 * 3600 + 12 * 60)).toBe('3 days 4 hours')
  })
})
