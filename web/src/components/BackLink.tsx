import { Link, useLocation, useNavigate } from 'react-router-dom'
import { originOf } from '../lib/origin'
import { ChevronLeft } from './Icons'

/**
 * "‹ Calendar": back to where this page was opened from, or to `fallback` when it
 * was opened directly. Going back through the browser history keeps that page as
 * it was (the calendar's month and day, the scroll position).
 */
export function BackLink({ fallback }: { fallback: { to: string; label: string } }) {
  const { state } = useLocation()
  const navigate = useNavigate()
  const origin = originOf(state)
  const back = origin?.back ?? fallback
  const canPop = Boolean(origin) && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <Link
      to={back.to}
      onClick={(e) => {
        if (!canPop) return
        e.preventDefault()
        navigate(-1)
      }}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 self-start rounded-lg px-1 text-sm text-muted hover:text-ink"
    >
      <ChevronLeft className="size-4" />
      {back.label}
    </Link>
  )
}
