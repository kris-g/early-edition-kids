import { useState } from 'react'
import { currentApiRoot } from '../api/client'

/** The source article's photo, as the iPad reader shows it above the story (the Kindle has none). */
export function StoryPhoto({ id, alt }: { id: number; alt: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <figure className="m-0 mb-4 overflow-hidden rounded-2xl border border-line bg-card">
      <img
        src={`${currentApiRoot()}/stories/${id}/image`}
        alt={alt ?? ''}
        loading="lazy"
        onError={() => setFailed(true)}
        className="block max-h-[420px] w-full object-cover"
      />
      <figcaption className="px-[18px] py-2.5 text-xs text-muted">The photo the iPad shows with this story. The Kindle shows no pictures.</figcaption>
    </figure>
  )
}
