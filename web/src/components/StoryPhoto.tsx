import { useState } from 'react'
import { currentApiRoot } from '../api/client'

/**
 * The source article's photo, above the story. Both readers show it: the iPad as it
 * came, the Kindle a grey copy under the headline (CONTRACT.md "Story photos").
 */
export function StoryPhoto({ id, alt }: { id: number; alt: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <figure className="m-0 mb-4 overflow-hidden rounded-2xl border border-line bg-card">
      {/* The whole photo, never cropped: a tall one is shown narrower, with the card either side. */}
      <img
        src={`${currentApiRoot()}/stories/${id}/image`}
        alt={alt ?? ''}
        loading="lazy"
        onError={() => setFailed(true)}
        className="block max-h-[420px] w-full object-contain"
      />
      <figcaption className="px-[18px] py-2.5 text-xs text-muted">
        The photo with this story. The iPad shows it in colour; the Kindle shows a grey copy under the headline.
      </figcaption>
    </figure>
  )
}
