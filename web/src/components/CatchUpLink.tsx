import { Link } from 'react-router-dom'
import { dayPath } from '../lib/day'
import { ChevronRight } from './Icons'

/** "+3 read from earlier papers" under today's paper, opening what he read today. */
export function CatchUpLink({ count, today }: { count: number; today: string }) {
  if (count <= 0) return null
  return (
    <Link
      to={dayPath(today)}
      className="inline-flex items-center gap-0.5 self-start text-[13px] font-bold text-accent hover:underline"
    >
      +{count} read from earlier papers
      <ChevronRight className="size-4" />
    </Link>
  )
}
