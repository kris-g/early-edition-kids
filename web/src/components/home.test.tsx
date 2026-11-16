import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { IssueView } from '../api/types'
import { KindlePill, NoDeviceYet } from './home'

describe('NoDeviceYet', () => {
  const prompt = (seenAt: string | null | undefined) =>
    render(
      <MemoryRouter>
        <NoDeviceYet seenAt={seenAt} />
      </MemoryRouter>,
    )

  it('points at the Devices page until a Kindle or an iPad has asked for a paper', () => {
    prompt(null)
    expect(screen.getByRole('link', { name: /No Kindle or iPad has picked up a paper yet/ })).toHaveAttribute('href', '/devices')
  })

  it('goes once one has, and while the summary is still loading', () => {
    const { container, rerender } = prompt('2026-11-15T19:22:21.000Z')
    expect(container).toBeEmptyDOMElement()
    rerender(
      <MemoryRouter>
        <NoDeviceYet seenAt={undefined} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

const issue = (downloadedAt?: string): IssueView => ({
  date: '2026-11-15',
  version: 1,
  fallback: false,
  created_at: '2026-11-15T05:31:12+00:00',
  downloaded_by: downloadedAt ? [{ device: 'f301357b', version: 1, received_at: downloadedAt }] : [],
  read_count: 0,
  stories: [],
})

describe('KindlePill', () => {
  it('shows the last sync once the Kindle has checked in after downloading', () => {
    render(<KindlePill issue={issue('2026-11-15T13:49:24+00:00')} seenAt="2026-11-15T19:22:21.000Z" />)
    expect(screen.getByText('Kindle synced 19:22')).toBeInTheDocument()
  })

  it('falls back to the download time without a later check-in', () => {
    render(<KindlePill issue={issue('2026-11-15T13:49:24+00:00')} seenAt="2026-11-15T06:00:00.000Z" />)
    expect(screen.getByText('On the Kindle 13:49')).toBeInTheDocument()
  })

  it('says when today’s paper has not reached the Kindle', () => {
    render(<KindlePill issue={issue()} seenAt="2026-11-15T19:22:21.000Z" />)
    expect(screen.getByText('Not on the Kindle yet')).toBeInTheDocument()
  })
})
