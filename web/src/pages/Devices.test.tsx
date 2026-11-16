import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProfilesContext } from '../lib/profile'
import { Devices } from './Devices'

describe('Devices', () => {
  it('has the Kindle and the iPad setup, with the addresses for the child shown now', () => {
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
  })
})
