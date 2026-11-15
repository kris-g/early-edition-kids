import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { IssueView } from '../api/types'
import { KindlePill } from './home'

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
