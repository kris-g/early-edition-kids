import { createContext } from 'react'

export type ActiveTip = { id: string; text: string; el: HTMLElement; onHide?: () => void }

export type TipCtx = {
  activeId: string | null
  show: (tip: ActiveTip) => void
  hide: (id?: string) => void
}

export const TipContext = createContext<TipCtx | null>(null)
