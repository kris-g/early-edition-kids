import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StoryPhoto } from './StoryPhoto'

describe('StoryPhoto', () => {
  it('shows a small, uncropped photo that opens full size, and says both readers show it', () => {
    render(<StoryPhoto id={41} alt="Harry Kane holds the trophy" />)
    const img = screen.getByRole('img', { name: 'Harry Kane holds the trophy' })
    expect(img).toHaveAttribute('src', '/api/dashboard/stories/41/image')
    // Sized by its own shape within limits: never cut to fill a box.
    expect(img).not.toHaveClass('object-cover')
    expect(img).toHaveClass('max-h-[150px]')
    const link = screen.getByRole('link', { name: 'Open the photo full size' })
    expect(link).toHaveAttribute('href', '/api/dashboard/stories/41/image')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toContainElement(img)
    expect(screen.getByText(/The iPad shows it in colour; the Kindle shows a grey copy under the headline\./)).toBeInTheDocument()
    expect(screen.queryByText(/no pictures/)).not.toBeInTheDocument()
  })

  it('goes away when the photo cannot be loaded', () => {
    const { container } = render(<StoryPhoto id={41} alt={null} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container).toBeEmptyDOMElement()
  })
})
