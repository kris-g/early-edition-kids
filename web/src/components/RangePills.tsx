import { RANGES, type RangeDays } from '../lib/ranges'
import { TogglePill } from './ui'

export function RangePills({ value, onChange }: { value: RangeDays; onChange: (days: RangeDays) => void }) {
  return (
    <div role="group" aria-label="Time range" className="flex flex-wrap gap-1.5 desk:gap-2">
      {RANGES.map((r) => (
        <TogglePill key={r.days} pressed={value === r.days} onClick={() => onChange(r.days)} className="desk:px-3.5">
          {r.label}
        </TogglePill>
      ))}
    </div>
  )
}
