import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { childAddresses, guessKindleBase, ProfilesContext, type ProfilesState } from '../lib/profile'
import { ReadOnIpad } from './ReadOnIpad'

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
        <ReadOnIpad />
      </MemoryRouter>
    </ProfilesContext.Provider>,
  )

describe('Read on an iPad', () => {
  it('gives one child the plain addresses, a QR code and the steps', async () => {
    const { container } = card(state({}))
    expect(screen.getByText('http://192.168.1.50:8080/read/')).toBeInTheDocument()
    expect(screen.getByText('http://192.168.1.50:8080')).toBeInTheDocument()
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument()
    expect(screen.getByText(/home Wi-Fi/)).toBeInTheDocument()
    expect(screen.queryByText(/KINDLE_BASE_URL/)).toBeNull()
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
  })

  it('puts a second child under /p/<id>, and says how to fix an address it had to guess', () => {
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
    expect(screen.getByText('Reader address for younger')).toBeInTheDocument()
    expect(screen.getByText('http://nas.local:8080/p/younger/read/')).toBeInTheDocument()
    expect(screen.getByText('http://nas.local:8080/p/younger')).toBeInTheDocument()
    expect(screen.getByText('KINDLE_BASE_URL')).toBeInTheDocument()
  })

  it('works the addresses out', () => {
    expect(childAddresses('http://h:8080', 'older', true)).toEqual({ kindle: 'http://h:8080', reader: 'http://h:8080/read/' })
    expect(childAddresses('http://h:8080', 'younger', false)).toEqual({
      kindle: 'http://h:8080/p/younger',
      reader: 'http://h:8080/p/younger/read/',
    })
    expect(guessKindleBase('nas.local')).toEqual({ url: 'http://nas.local:8080', derived: true })
    expect(guessKindleBase('::1').url).toBe('http://[::1]:8080')
  })
})
