import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProfilesContext, SINGLE } from '../lib/profile'
import { More } from './More'

const page = (login: boolean) =>
  render(
    <ProfilesContext.Provider value={{ profiles: [], current: SINGLE, login, switchTo: () => {} }}>
      <MemoryRouter initialEntries={['/more']}>
        <More />
      </MemoryRouter>
    </ProfilesContext.Provider>,
  )

describe('More', () => {
  it('has no sign-out without the built-in sign-in', () => {
    page(false)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(screen.getByText('Signed in through Authelia')).toBeInTheDocument()
  })

  it('signs out with a plain form post to /logout when the built-in sign-in is on', () => {
    page(true)
    const button = screen.getByRole('button', { name: 'Sign out' })
    const form = button.closest('form')!
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/logout')
    expect(screen.queryByText('Signed in through Authelia')).toBeNull()
  })
})
