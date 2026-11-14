import { useEffect, useRef } from 'react'
import { cx } from '../lib/cx'
import type { ShareCard } from '../lib/shareCards'
import { CARD_H, CARD_W, drawCard, loadCardFonts, type ThemeId } from '../lib/shareDraw'

/** A share card drawn at full size (1080 x 1350) and scaled to fit its box by CSS. */
export function ShareCanvas({ card, theme, className }: { card: ShareCard; theme: ThemeId; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let live = true
    loadCardFonts().then(() => {
      const canvas = ref.current
      if (!live || !canvas) return
      let c: CanvasRenderingContext2D | null
      try {
        c = canvas.getContext('2d')
      } catch {
        c = null
      }
      if (c) drawCard(c, card, theme)
    })
    return () => {
      live = false
    }
  }, [card, theme])

  return (
    <canvas
      ref={ref}
      width={CARD_W}
      height={CARD_H}
      role="img"
      aria-label={card.alt}
      className={cx('block h-auto w-full', className)}
    />
  )
}
