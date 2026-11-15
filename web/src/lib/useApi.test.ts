import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApi } from './useApi'

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useApi', () => {
  afterEach(() => setVisibility('visible'))

  it('fetches again when the app comes back into view, keeping the old data meanwhile', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ++n)
    const { result } = renderHook(() => useApi('summary', fetcher))
    await waitFor(() => expect(result.current.data).toBe(1))

    act(() => setVisibility('hidden'))
    expect(fetcher).toHaveBeenCalledTimes(1) // going away fetches nothing

    act(() => setVisibility('visible'))
    expect(result.current.data).toBe(1)
    await waitFor(() => expect(result.current.data).toBe(2))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not fetch on return when the key is null', () => {
    const fetcher = vi.fn(async () => 1)
    renderHook(() => useApi(null, fetcher))
    act(() => setVisibility('visible'))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
