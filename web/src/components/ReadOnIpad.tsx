import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { childAddresses, guessKindleBase, useProfiles } from '../lib/profile'
import { Button, Card, SectionTitle } from './ui'

/**
 * Getting the child's reader onto an iPad (CONTRACT.md "iPad reader"): the reader's address for
 * the child shown now, a QR code of it for the iPad's camera, and how to put it on the Home
 * Screen. The Kindle's server address is here too, since setting up a Kindle needs it.
 */
export function ReadOnIpad() {
  const { profiles, current, root, kindle } = useProfiles()
  const base = kindle ?? guessKindleBase(window.location.hostname)
  const isRoot = root ? root === current.id : !current.prefixed
  const { reader, kindle: kindleAddress } = childAddresses(base.url, current.id, isRoot)
  const several = profiles.length > 1
  const qr = useQrSvg(reader)

  return (
    <>
      <SectionTitle className="mt-2">Read on an iPad</SectionTitle>
      <Card label="Read on an iPad" className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 desk:flex-row desk:items-start desk:gap-6">
          <div
            className="mx-auto size-[184px] shrink-0 overflow-hidden rounded-xl border border-line bg-white p-2 desk:mx-0"
            role="img"
            aria-label={`QR code for ${reader}`}
          >
            {qr && <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Address label={several ? `Reader address for ${current.id}` : 'Reader address'} value={reader} />
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              <Step n={1}>On the iPad, point the Camera at the code and tap the link, or type the address into Safari.</Step>
              <Step n={2}>In Safari, tap Share.</Step>
              <Step n={3}>Tap Add to Home Screen, then Add.</Step>
            </ol>
            <p className="m-0 text-[13px] text-muted">
              The iPad needs to be on the home Wi-Fi: the reader talks only to this server. It has no links out of the paper and no way into
              this dashboard.
            </p>
          </div>
        </div>
        <div className="border-t border-line pt-3">
          <Address label={several ? `Kindle server address for ${current.id}` : 'Kindle server address'} value={kindleAddress} />
          <p className="m-0 mt-1 text-[13px] text-muted">For the Kindle: Early Edition settings, then Server address.</p>
        </div>
        {base.derived && (
          <p className="m-0 rounded-xl bg-chip px-3.5 py-2.5 text-[13px] text-muted">
            These addresses were worked out from this page’s own address. If the iPad can’t open them, set{' '}
            <code className="font-semibold text-ink">KINDLE_BASE_URL</code> on the server to the address the Kindle uses, such as{' '}
            <code className="font-semibold text-ink">http://192.168.1.50:8080</code>, and restart it.
          </p>
        )}
      </Card>
    </>
  )
}

function useQrSvg(text: string): string | null {
  const [svg, setSvg] = useState<{ text: string; svg: string } | null>(null)
  useEffect(() => {
    let live = true
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(
      (out) => live && setSvg({ text, svg: out }),
      () => live && setSvg(null),
    )
    return () => {
      live = false
    }
  }, [text])
  return svg && svg.text === text ? svg.svg : null
}

function Address({ label, value }: { label: string; value: string }) {
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

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-bg">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  )
}
