import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '../test/fixtures'
import { Runs } from './Runs'

afterEach(() => vi.unstubAllGlobals())

describe('Server', () => {
  it('shows what the server is and where it runs, then its recent runs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) =>
        String(input).includes('/about')
          ? jsonResponse({ version: '0.2.0', arch: 'arm64', platform: 'linux', container: 'kubernetes', uptime_seconds: 7500 })
          : jsonResponse([]),
      ),
    )
    render(
      <MemoryRouter initialEntries={['/runs']}>
        <Runs />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Server' })).toBeInTheDocument()
    const about = screen.getByRole('region', { name: 'About this server' })
    expect(await screen.findByText('Kubernetes, arm64')).toBeInTheDocument()
    expect(about).toHaveTextContent('Running for2 hours 5 minutes')
    expect(screen.getByRole('heading', { name: 'Recent runs' })).toBeInTheDocument()
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
  })
})
