import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StoryPhoto } from './StoryPhoto'

describe('StoryPhoto', () => {
  it('shows the whole photo, and says both readers show it', () => {
    render(<StoryPhoto id={41} alt="Harry Kane holds the trophy" />)
    const img = screen.getByRole('img', { name: 'Harry Kane holds the trophy' })
    expect(img).toHaveAttribute('src', '/api/dashboard/stories/41/image')
    // Fitted inside its box, not cut to fill it.
    expect(img).toHaveClass('object-contain')
    expect(img).not.toHaveClass('object-cover')
    expect(screen.getByText(/The iPad shows it in colour; the Kindle shows a grey copy under the headline\./)).toBeInTheDocument()
    expect(screen.queryByText(/no pictures/)).not.toBeInTheDocument()
  })

  it('goes away when the photo cannot be loaded', () => {
    const { container } = render(<StoryPhoto id={41} alt={null} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container).toBeEmptyDOMElement()
  })
})
