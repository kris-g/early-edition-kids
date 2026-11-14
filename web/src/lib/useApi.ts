import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isAbort } from '../api/client'

type State<T> = { key: string | null; run: number; data?: T; error?: Error }

export type ApiState<T> = {
  data: T | undefined
  error: Error | undefined
  /** True while a fetch for the current key is in flight (data may still hold the previous result). */
  loading: boolean
  reload: () => void
  /** Replace the data locally, e.g. with the result of a mutation. */
  mutate: (update: (data: T | undefined) => T | undefined) => void
}

/**
 * Fetch `fetcher` whenever `key` changes (null skips). Keeps the last data while
 * reloading so the page does not flash, and aborts stale requests.
 */
export function useApi<T>(key: string | null, fetcher: (signal: AbortSignal) => Promise<T>): ApiState<T> {
  const [state, setState] = useState<State<T>>({ key: null, run: -1 })
  const [run, setRun] = useState(0)
  const fetcherRef = useRef(fetcher)
  useLayoutEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (key === null) return
    const ctrl = new AbortController()
    fetcherRef.current(ctrl.signal).then(
      (data) => setState({ key, run, data }),
      (error: unknown) => {
        if (ctrl.signal.aborted || isAbort(error)) return
        setState((prev) => ({
          key,
          run,
          data: prev.key === key ? prev.data : undefined,
          error: error instanceof Error ? error : new Error(String(error)),
        }))
      },
    )
    return () => ctrl.abort()
  }, [key, run])

  const reload = useCallback(() => setRun((r) => r + 1), [])
  const mutate = useCallback(
    (update: (data: T | undefined) => T | undefined) =>
      setState((prev) => ({ ...prev, data: update(prev.data) })),
    [],
  )

  const current = state.key === key
  return {
    data: current ? state.data : undefined,
    error: current && state.run === run ? state.error : undefined,
    loading: key !== null && (!current || state.run !== run),
    reload,
    mutate,
  }
}

/** The value after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}
