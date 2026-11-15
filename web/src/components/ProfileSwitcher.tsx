import { useId } from 'react'
import { cx } from '../lib/cx'
import { useProfiles } from '../lib/profile'
import { ChevronDown } from './Icons'

/**
 * Which child's paper is shown. Only there with more than one profile. A native
 * select, so phones get their own picker. `wide` is the desktop sidebar's
 * labelled version; otherwise it is a compact pill for the phone header.
 */
export function ProfileSwitcher({ wide = false }: { wide?: boolean }) {
  const { profiles, current, switchTo } = useProfiles()
  const id = useId()
  if (profiles.length < 2) return null
  const select = (
    <span className={cx('relative flex items-center', wide && 'w-full')}>
      <select
        id={id}
        value={current.id}
        onChange={(e) => switchTo(e.target.value)}
        aria-label={wide ? undefined : 'Whose paper'}
        className={cx(
          'min-h-11 cursor-pointer appearance-none border border-line bg-card font-semibold text-ink hover:bg-chip',
          wide ? 'w-full rounded-[10px] pr-9 pl-3 text-[15px]' : 'max-w-[7.5rem] truncate rounded-full pr-7 pl-3 text-[13px]',
        )}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id}
          </option>
        ))}
      </select>
      <ChevronDown className={cx('pointer-events-none absolute text-muted', wide ? 'right-3 size-[18px]' : 'right-2.5 size-4')} />
    </span>
  )
  if (!wide) return select
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-[11px] font-bold tracking-[0.12em] text-muted uppercase">
        Whose paper
      </label>
      {select}
    </div>
  )
}
