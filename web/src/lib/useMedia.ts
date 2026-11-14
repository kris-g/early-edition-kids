import { useSyncExternalStore } from 'react'

/** True while the media query matches (false where matchMedia is missing, e.g. tests). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      try {
        const mq = window.matchMedia(query)
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
      } catch {
        return () => {}
      }
    },
    () => {
      try {
        return window.matchMedia(query).matches
      } catch {
        return false
      }
    },
    () => false,
  )
}

export const DESK_QUERY = '(min-width: 900px)'
