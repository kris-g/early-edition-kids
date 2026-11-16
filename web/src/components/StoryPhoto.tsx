import { useState } from 'react'
import { currentApiRoot } from '../api/client'

/**
 * The source article's photo, above the story. Both readers show it: the iPad as it
 * came, the Kindle a grey copy under the headline (CONTRACT.md "Story photos").
 *
 * On the dashboard it is a small picture beside its caption: enough for a parent to
 * see what he sees, without pushing the story down the page. It is never cropped,
 * and a press opens the photo itself.
 */
export function StoryPhoto({ id, alt }: { id: number; alt: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const src = `${currentApiRoot()}/stories/${id}/image`
  return (
    <figure className="m-0 mb-4 flex items-center gap-3.5 rounded-2xl border border-line bg-card p-2.5 pr-4">
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open the photo full size"
        title="Open the photo full size"
        className="block max-w-[min(220px,42%)] shrink-0 overflow-hidden rounded-[10px]"
      >
        {/* Sized by its own shape inside these limits, so nothing is cut off. */}
        <img src={src} alt={alt ?? ''} loading="lazy" onError={() => setFailed(true)} className="block h-auto max-h-[150px] w-auto max-w-full" />
      </a>
      <figcaption className="min-w-0 text-xs leading-relaxed text-muted">
        The photo with this story. The iPad shows it in colour; the Kindle shows a grey copy under the headline.
      </figcaption>
    </figure>
  )
}
