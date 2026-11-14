import { useContext, useRef, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { TipContext } from './context'

const TOUCH_GRACE_MS = 800

type Opts = {
  /** Default 0. Charts with many marks pass a roving value (0 for one mark, -1 for the rest). */
  tabIndex?: number
  /** Called when this mark's tooltip shows or hides (e.g. to draw a marker). */
  onShow?: () => void
  onHide?: () => void
  onFocus?: (e: FocusEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
  /** Leave the aria-label off (the element already has an accessible name). */
  noLabel?: boolean
}

/**
 * Props for a chart mark (bar, point, cell) that shows a tooltip on hover,
 * keyboard focus, or tap. Without a TooltipProvider it still gives the mark
 * its aria-label and tab stop.
 */
export function useTip() {
  const ctx = useContext(TipContext)
  const lastTouch = useRef(0)
  const touching = useRef(false)

  return function tipProps(id: string, text: string, opts: Opts = {}) {
    const show = (el: HTMLElement) => {
      ctx?.show({ id, text, el, onHide: opts.onHide })
      opts.onShow?.()
    }
    const recentTouch = () => Date.now() - lastTouch.current < TOUCH_GRACE_MS
    return {
      'data-tip': '',
      'aria-label': opts.noLabel ? undefined : text,
      tabIndex: opts.tabIndex ?? 0,
      onMouseEnter: (e: { currentTarget: HTMLElement }) => {
        if (!recentTouch()) show(e.currentTarget)
      },
      onMouseLeave: () => {
        if (!recentTouch()) ctx?.hide(id)
      },
      onFocus: (e: FocusEvent<HTMLElement>) => {
        opts.onFocus?.(e)
        if (!touching.current && !recentTouch()) show(e.currentTarget)
      },
      onBlur: () => ctx?.hide(id),
      onKeyDown: opts.onKeyDown,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') return
        touching.current = true
        lastTouch.current = Date.now()
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') return
        touching.current = false
        lastTouch.current = Date.now()
        if (ctx?.activeId === id) ctx.hide(id)
        else show(e.currentTarget)
      },
    }
  }
}
