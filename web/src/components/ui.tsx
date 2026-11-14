import type { ComponentProps, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cx } from '../lib/cx'
import { AlertIcon } from './Icons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent font-bold hover:brightness-110',
  secondary: 'border border-line bg-transparent text-ink font-semibold hover:bg-chip',
  ghost: 'text-muted font-semibold hover:bg-chip hover:text-ink',
  danger: 'bg-danger text-card font-bold hover:brightness-110',
}

const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm transition select-none disabled:cursor-not-allowed disabled:opacity-50'

export function Button({
  variant = 'secondary',
  className,
  busy,
  children,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={cx(BASE, VARIANT[variant], className)}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function LinkButton({ variant = 'secondary', className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link {...props} className={cx(BASE, VARIANT[variant], className)} />
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-muted">
      <Spinner />
      {label}
    </div>
  )
}

type Tone = 'neutral' | 'green' | 'amber' | 'blue' | 'rose' | 'violet'

const TONE: Record<Tone, string> = {
  neutral: 'bg-chip text-muted',
  green: 'bg-accent-soft text-accent',
  amber: 'bg-warm-soft text-warm',
  blue: 'bg-chip text-ink',
  rose: 'bg-danger-soft text-danger',
  violet: 'bg-chip text-ink',
}

/** A rounded status pill (12px bold, as in the mockups). */
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx('inline-flex items-center gap-1 rounded-full px-[9px] py-1 text-xs leading-none font-bold', TONE[tone])}
    >
      {children}
    </span>
  )
}

/** Topic label: small capitals in the muted colour. */
export function TopicChip({ topic }: { topic: string }) {
  return <span className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">{topic}</span>
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('text-[11px] font-bold tracking-[0.1em] text-muted uppercase', className)}>{children}</span>
  )
}

export function Card({
  className,
  children,
  label,
  as = 'div',
}: {
  className?: string
  children: ReactNode
  /** Makes it a labelled <section>. */
  label?: string
  as?: 'div' | 'section'
}) {
  const Tag = label ? 'section' : as
  return (
    <Tag aria-label={label} className={cx('rounded-2xl border border-line bg-card p-[18px]', className)}>
      {children}
    </Tag>
  )
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-2xl border border-danger/40 bg-danger-soft p-4 text-sm text-ink"
    >
      <AlertIcon className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">{children}</div>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  )
}

/** The page title block: a muted line above a big Playfair heading. */
export function PageHeader({
  title,
  subtitle,
  action,
  size = 'lg',
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  size?: 'lg' | 'md'
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {subtitle && <div className="text-[13px] text-muted">{subtitle}</div>}
        <h1
          className={cx(
            'm-0 font-display leading-[1.1] font-black',
            size === 'lg' ? 'text-[34px] desk:text-[40px]' : 'text-[30px]',
          )}
        >
          {title}
        </h1>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('m-0 text-[17px] font-bold desk:text-lg', className)}>{children}</h2>
}

export function BigNumber({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('font-display leading-none font-black', className)}>{children}</span>
}

/** Range or option pills: ink when on (aria-pressed), outlined when off. */
export function TogglePill({
  pressed,
  className,
  ...props
}: ComponentProps<'button'> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cx(
        'min-h-11 rounded-full border px-4 text-[13px] transition',
        pressed ? 'border-ink bg-ink font-bold text-bg' : 'border-line bg-transparent font-semibold text-ink hover:bg-chip',
        className,
      )}
    />
  )
}

/** Segmented choices (checker model, effort): squarer than TogglePill. */
export function Segment({ pressed, className, ...props }: ComponentProps<'button'> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cx(
        'min-h-[46px] rounded-[10px] border px-1 text-[13px] font-bold transition',
        pressed ? 'border-ink bg-ink text-bg' : 'border-line bg-transparent text-ink hover:bg-chip',
        className,
      )}
    />
  )
}
