import { useCallback, useState } from 'react'
import { messageOf } from '../api/client'
import { api } from '../api/endpoints'
import type { StoryCard } from '../api/types'

/** Hide or unhide a story; hands the server's updated card to `onUpdated`. */
export function useHideToggle(onUpdated: (card: StoryCard) => void) {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = useCallback(
    async (story: Pick<StoryCard, 'id' | 'hidden'>) => {
      setBusyId(story.id)
      setError(null)
      try {
        const card = story.hidden ? await api.unhide(story.id) : await api.hide(story.id)
        onUpdated(card)
      } catch (err) {
        setError(messageOf(err))
      } finally {
        setBusyId(null)
      }
    },
    [onUpdated],
  )

  return { busyId, error, toggle, clearError: () => setError(null) }
}
