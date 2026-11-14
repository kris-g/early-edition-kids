import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { TipContext, type ActiveTip } from './context'

const GAP = 8
const EDGE = 8

/**
 * One tooltip for the whole app. Marks register through useTip(); the card is a
 * fixed-position portal, so it never shifts layout and is never clipped by a
 * chart. It sits above the mark, flips below near the top edge, and is clamped
 * to the screen sideways. Escape or a tap elsewhere hides it.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveTip | null>(null)
  const activeRef = useRef<ActiveTip | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const show = useCallback((tip: ActiveTip) => {
    const prev = activeRef.current
    if (prev && prev.id !== tip.id) prev.onHide?.()
    activeRef.current = tip
    setActive(tip)
  }, [])

  const hide = useCallback((id?: string) => {
    const prev = activeRef.current
    if (!prev || (id !== undefined && prev.id !== id)) return
    prev.onHide?.()
    activeRef.current = null
    setActive(null)
  }, [])

  const place = useCallback(() => {
    const box = boxRef.current
    const tip = activeRef.current
    if (!box || !tip) return
    if (!tip.el.isConnected) return hide()
    const r = tip.el.getBoundingClientRect()
    const w = box.offsetWidth
    const h = box.offsetHeight
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    let top = r.top - h - GAP
    if (top < EDGE) top = Math.min(r.bottom + GAP, vh - h - EDGE)
    const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - w / 2, vw - w - EDGE))
    box.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(EDGE, top))}px)`
    box.style.visibility = 'visible'
  }, [hide])

  useLayoutEffect(() => {
    place()
  }, [active, place])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || !t.closest('[data-tip]')) hide()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [active, hide, place])

  const value = useMemo(() => ({ activeId: active?.id ?? null, show, hide }), [active, show, hide])

  return (
    <TipContext.Provider value={value}>
      {children}
      {active &&
        createPortal(
          <div
            ref={boxRef}
            role="tooltip"
            className="pointer-events-none fixed top-0 left-0 z-[60] max-w-[min(280px,calc(100vw-16px))] rounded-[10px] border border-line bg-card px-3 py-2 text-[13px] leading-snug font-semibold text-ink shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
            style={{ visibility: 'hidden' }}
          >
            {active.text}
          </div>,
          document.body,
        )}
    </TipContext.Provider>
  )
}
