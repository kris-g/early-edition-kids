import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProfilesContext, type ProfilesState } from '../lib/profile'
import { PLUGIN_RELEASE_URL, SetUpKindle } from './SetUpKindle'

const state = (over: Partial<ProfilesState>): ProfilesState => ({
  profiles: [{ id: 'default', title: 'Early Edition' }],
  current: { id: 'default', prefixed: false },
  login: false,
  root: 'default',
  kindle: { url: 'http://192.168.1.50:8080', derived: false },
  switchTo: () => {},
  ...over,
})

const card = (s: ProfilesState) =>
  render(
    <ProfilesContext.Provider value={s}>
      <MemoryRouter>
        <SetUpKindle />
      </MemoryRouter>
    </ProfilesContext.Provider>,
  )

describe('Set up a Kindle', () => {
  it('gives one child the plain server address and the install steps', () => {
    card(state({}))
    expect(screen.getByText('Server address')).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.50:8080')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'latest release' })).toHaveAttribute('href', PLUGIN_RELEASE_URL)
    expect(screen.getByText('earlyeditionkids.koplugin')).toBeInTheDocument()
    expect(screen.getByText('Early Edition settings → Server address')).toBeInTheDocument()
    expect(screen.getByText(/Action when Wi-Fi is off/)).toBeInTheDocument()
    expect(screen.queryByText(/KINDLE_BASE_URL/)).toBeNull()
  })

  it('gives a second child their /p/<id> address, and says how to fix one it had to guess', () => {
    card(
      state({
        profiles: [
          { id: 'older', title: 'Early Edition' },
          { id: 'younger', title: 'Little Edition' },
        ],
        current: { id: 'younger', prefixed: true },
        root: 'older',
        kindle: { url: 'http://nas.local:8080', derived: true },
      }),
    )
    expect(screen.getByText('Server address for younger')).toBeInTheDocument()
    expect(screen.getByText('http://nas.local:8080/p/younger')).toBeInTheDocument()
    expect(screen.getByText('KINDLE_BASE_URL')).toBeInTheDocument()
  })
})
