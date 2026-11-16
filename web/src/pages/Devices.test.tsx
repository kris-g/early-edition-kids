import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilesContext } from '../lib/profile'
import { jsonResponse } from '../test/fixtures'
import { Devices } from './Devices'

afterEach(() => vi.unstubAllGlobals())

describe('Devices', () => {
  it('has the Kindle and the iPad setup, with the addresses for the child shown now, and the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ version: '0.2.0', arch: 'arm64', platform: 'linux', container: 'kubernetes', uptime_seconds: 7500 }),
      ),
    )
    render(
      <ProfilesContext.Provider
        value={{
          profiles: [{ id: 'default', title: 'Early Edition' }],
          current: { id: 'default', prefixed: false },
          login: false,
          root: 'default',
          kindle: { url: 'http://192.168.1.50:8080', derived: false },
          switchTo: () => {},
        }}
      >
        <MemoryRouter initialEntries={['/devices']}>
          <Devices />
        </MemoryRouter>
      </ProfilesContext.Provider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Devices' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Set up a Kindle' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Read on an iPad' })).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.50:8080')).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.50:8080/read/')).toBeInTheDocument()
    const about = screen.getByRole('region', { name: 'About this server' })
    expect(await screen.findByText('Kubernetes, arm64')).toBeInTheDocument()
    expect(about).toHaveTextContent('Running for2 hours 5 minutes')
  })
})
