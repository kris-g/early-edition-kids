import { useState, type ReactNode } from 'react'
import { Button } from './ui'

/** An address to type on a device, with a Copy button where the browser allows it. */
export function Address({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText)
  const copy = () => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => {},
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-chip px-3 py-2 text-[13px] break-all text-ink">{value}</code>
        {canCopy && (
          <Button variant="ghost" onClick={copy} aria-label={`Copy the ${label.toLowerCase()}`}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>
    </div>
  )
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">{children}</ol>
}

export function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-bg">{n}</span>
      <span className="min-w-0 pt-0.5">{children}</span>
    </li>
  )
}

/** Shown when the server didn't say where the Kindle port is, so the address is a guess. */
export function GuessedAddressNote({ device }: { device: string }) {
  return (
    <p className="m-0 rounded-xl bg-chip px-3.5 py-2.5 text-[13px] text-muted">
      This address was worked out from this page’s own address. If the {device} can’t reach it, set{' '}
      <code className="font-semibold text-ink">KINDLE_BASE_URL</code> on the server to the address the {device} should use, such as{' '}
      <code className="font-semibold text-ink">http://192.168.1.50:8080</code>, and restart it.
    </p>
  )
}

/** The menu path in KOReader, set in bold so it can be followed on the Kindle. */
export function Path({ children }: { children: ReactNode }) {
  return <b className="font-semibold">{children}</b>
}
