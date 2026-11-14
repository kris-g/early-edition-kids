import { useState, type KeyboardEvent } from 'react'

/**
 * One tab stop per chart: Tab reaches the chart, arrow keys (and Home/End) move
 * between its marks. Marks are the [data-tip] elements inside the container
 * the key event comes from.
 */
export function useRoving(count: number, initial = count - 1) {
  const [current, setCurrent] = useState(Math.max(0, Math.min(initial, count - 1)))
  const safe = Math.max(0, Math.min(current, count - 1))

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let next: number | null = null
    if (e.key in keys) next = safe + keys[e.key]
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    if (next === null) return
    e.preventDefault()
    next = Math.max(0, Math.min(next, count - 1))
    const group = (e.currentTarget.closest('[data-roving]') ?? e.currentTarget.parentElement) as HTMLElement | null
    const marks = group ? Array.from(group.querySelectorAll<HTMLElement>('[data-tip]')) : []
    marks[next]?.focus()
    setCurrent(next)
  }

  return {
    tabIndex: (i: number) => (i === safe ? 0 : -1),
    onFocus: (i: number) => () => setCurrent(i),
    onKeyDown,
  }
}
