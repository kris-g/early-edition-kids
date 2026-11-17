import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilesContext } from '../lib/profile'
import { jsonResponse } from '../test/fixtures'
import { Devices } from './Devices'

afterEach(() => vi.unstubAllGlobals())

describe('Devices', () => {
  it('has the Kindle and the iPad setup, with the addresses for the child shown now, and not the server', () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => jsonResponse({})))
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
    expect(screen.queryByRole('region', { name: 'About this server' })).toBeNull()
  })
})
