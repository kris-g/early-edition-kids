import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { StoryCard } from '../api/types'
import { card, stats } from '../test/fixtures'
import { StoryCardItem } from './StoryCardItem'

function renderCard(story: StoryCard, onToggleHidden?: (s: StoryCard) => void) {
  return render(
    <MemoryRouter>
      <StoryCardItem story={story} onToggleHidden={onToggleHidden} />
    </MemoryRouter>,
  )
}

describe('StoryCardItem status', () => {
  it.each([
    ['Not opened yet', stats()],
    ['Opened · 20 s', stats({ opened: true, active_seconds: 20 })],
    ['Read to the end · 1 min 50 s', stats({ opened: true, reached_end: true, active_seconds: 110 })],
    ['Read to the end · 2 min 05 s', stats({ opened: true, reached_end: true, active_seconds: 125, engaged: true })],
  ])('shows "%s"', (label, s) => {
    renderCard(card({ stats: s }))
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows the hidden and added-by-you badges', () => {
    renderCard(card({ hidden: true, added_by_parent: true }))
    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByText('Added by you')).toBeInTheDocument()
  })

  it('links to the story and shows topic and title', () => {
    renderCard(card({ id: 77 }))
    expect(screen.getByRole('link')).toHaveAttribute('href', '/story/77')
    expect(screen.getByText('Football')).toBeInTheDocument()
    expect(screen.getByText('Harry Kane wins the Ballon d’Or')).toBeInTheDocument()
  })

  it('offers hide, or unhide when hidden', async () => {
    const onToggle = vi.fn()
    const { unmount } = renderCard(card(), onToggle)
    await userEvent.click(screen.getByRole('button', { name: /^hide/i }))
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }))
    unmount()
    renderCard(card({ hidden: true }), onToggle)
    expect(screen.getByRole('button', { name: /^unhide/i })).toBeInTheDocument()
  })
})
