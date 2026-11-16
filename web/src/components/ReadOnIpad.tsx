import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useChildAddresses } from '../lib/profile'
import { Address, GuessedAddressNote, Step, Steps } from './SetupParts'
import { Card, SectionTitle } from './ui'

/**
 * Getting the child's reader onto an iPad (CONTRACT.md "iPad reader"): the reader's address for
 * the child shown now, a QR code of it for the iPad's camera, and how to put it on the Home
 * Screen. The Kindle has its own card (SetUpKindle).
 */
export function ReadOnIpad() {
  const { reader, derived, several, id } = useChildAddresses()
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
            <Address label={several ? `Reader address for ${id}` : 'Reader address'} value={reader} />
            <Steps>
              <Step n={1}>On the iPad, point the Camera at the code and tap the link, or type the address into Safari.</Step>
              <Step n={2}>In Safari, tap Share.</Step>
              <Step n={3}>Tap Add to Home Screen, then Add.</Step>
            </Steps>
            <p className="m-0 text-[13px] text-muted">
              The iPad needs to be on the home Wi-Fi: the reader talks only to this server. It has no links out of the paper and no way into
              this dashboard.
            </p>
          </div>
        </div>
        {derived && <GuessedAddressNote device="iPad" />}
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
