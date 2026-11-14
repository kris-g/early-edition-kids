import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/endpoints'
import { ChevronLeft, ChevronRight } from '../components/Icons'
import { ShareCanvas } from '../components/ShareCanvas'
import { Button, Card, ErrorNote, Loading, PageHeader } from '../components/ui'
import { cx } from '../lib/cx'
import { buildCards, CARD_IDS, CARD_INFO, type CardId, type ShareCard } from '../lib/shareCards'
import { cardPng, THEME_IDS, THEMES, type ThemeId } from '../lib/shareDraw'
import { readText, writeText } from '../lib/storage'
import { useApi } from '../lib/useApi'

const NAME_KEY = 'early-edition.share-name'
const THEME_KEY = 'early-edition.share-theme'

function savedTheme(): ThemeId {
  const t = readText(THEME_KEY)
  return (THEME_IDS as string[]).includes(t) ? (t as ThemeId) : 'paper'
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function canShareFiles(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([''], 'card.png', { type: 'image/png' })] })
    )
  } catch {
    return false
  }
}

function canCopyImage(): boolean {
  return typeof window !== 'undefined' && 'ClipboardItem' in window && typeof navigator.clipboard?.write === 'function'
}

export function Share() {
  const share = useApi('share', (signal) => api.share(signal))
  const [params] = useSearchParams()
  const [name, setName] = useState(() => readText(NAME_KEY))
  const [theme, setTheme] = useState<ThemeId>(savedTheme)
  useEffect(() => writeText(NAME_KEY, name), [name])
  useEffect(() => writeText(THEME_KEY, theme), [theme])

  const cards = useMemo(() => (share.data ? buildCards(share.data, name) : []), [share.data, name])
  const asked = CARD_IDS.indexOf(params.get('card') as CardId)
  const [index, setIndex] = useState(asked >= 0 ? asked : 0)
  const track = useRef<HTMLDivElement>(null)

  const slideAt = (i: number) => track.current?.querySelector<HTMLElement>(`[data-slide="${i}"]`) ?? null

  const goTo = useCallback((i: number, smooth = true) => {
    const el = track.current
    const slide = el?.querySelector<HTMLElement>(`[data-slide="${i}"]`)
    setIndex(i)
    if (!el || !slide) return
    const left = slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
    else el.scrollLeft = left
  }, [])

  // Open on the card asked for in ?card=, once the cards exist.
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (placed.current || !cards.length) return
    placed.current = true
    goTo(index, false)
  }, [cards.length, goTo, index])

  // Swiping: the slide nearest the middle is the current one.
  const onScroll = () => {
    const el = track.current
    if (!el) return
    const mid = el.scrollLeft + el.clientWidth / 2
    let best = 0
    let dist = Infinity
    for (let i = 0; i < CARD_IDS.length; i++) {
      const s = slideAt(i)
      if (!s) continue
      const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid)
      if (d < dist) {
        dist = d
        best = i
      }
    }
    if (best !== index) setIndex(best)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' && index < CARD_IDS.length - 1) {
      e.preventDefault()
      goTo(index + 1)
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault()
      goTo(index - 1)
    }
  }

  const current = cards[index]

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Share" subtitle="A picture of his reading, to send to family" />

      {share.error && <ErrorNote onRetry={share.reload}>{share.error.message}</ErrorNote>}
      {!share.data && share.loading && <Loading />}

      {current && (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desk:grid-cols-[minmax(0,1fr)_320px]">
          <section aria-label="Cards" className="flex min-w-0 flex-col gap-4">
            <div
              ref={track}
              tabIndex={0}
              role="region"
              aria-roledescription="carousel"
              aria-label="Share cards. Swipe, or use the arrow keys, to see the next card."
              onScroll={onScroll}
              onKeyDown={onKeyDown}
              className="share-track relative -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent desk:mx-0 desk:rounded-2xl"
            >
              <div aria-hidden="true" className="share-spacer shrink-0" />
              {cards.map((c, i) => (
                <div
                  key={c.id}
                  data-slide={i}
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${cards.length}: ${c.title}`}
                  className={cx(
                    'share-slide shrink-0 snap-center transition-opacity',
                    i === index ? 'opacity-100' : 'opacity-60',
                  )}
                >
                  {c.ready ? (
                    <div className="overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(23,23,23,0.08),0_12px_28px_rgba(23,23,23,0.12)] ring-1 ring-line">
                      <ShareCanvas card={c} theme={theme} />
                    </div>
                  ) : (
                    <NotReady card={c} />
                  )}
                </div>
              ))}
              <div aria-hidden="true" className="share-spacer shrink-0" />
            </div>

            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                aria-label="Previous card"
                disabled={index === 0}
                onClick={() => goTo(index - 1)}
                className="flex size-11 items-center justify-center rounded-full border border-line text-ink hover:bg-chip disabled:opacity-40"
              >
                <ChevronLeft className="size-5" />
              </button>
              <div className="flex items-center">
                {cards.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={`Show the ${c.title} card`}
                    aria-current={i === index ? 'true' : undefined}
                    onClick={() => goTo(i)}
                    className="flex size-8 items-center justify-center"
                  >
                    <span
                      className={cx(
                        'block h-2 rounded-full transition-all',
                        i === index ? 'w-6 bg-accent' : 'w-2 bg-line',
                      )}
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Next card"
                disabled={index === cards.length - 1}
                onClick={() => goTo(index + 1)}
                className="flex size-11 items-center justify-center rounded-full border border-line text-ink hover:bg-chip disabled:opacity-40"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-1 text-center" aria-live="polite">
              <h2 className="m-0 text-[17px] font-bold">{current.title}</h2>
              <p className="m-0 text-[13px] text-muted">{CARD_INFO[current.id].desc}</p>
            </div>

            <ShareActions card={current} theme={theme} />
          </section>

          <Card label="Options" className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="share-name" className="text-sm font-semibold">
                Name on the cards
              </label>
              <input
                id="share-name"
                type="text"
                autoComplete="off"
                maxLength={20}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="First name or initial"
                className="min-h-11 rounded-xl border border-line bg-bg px-3 text-[15px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <p className="m-0 text-xs leading-[1.45] text-muted">
                Leave it blank to keep his name off. It is kept on this device only and never sent to the server.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span id="share-colour" className="text-sm font-semibold">
                Colour
              </span>
              <div role="group" aria-labelledby="share-colour" className="flex gap-2.5">
                {THEME_IDS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={t === theme}
                    aria-label={THEMES[t].label}
                    onClick={() => setTheme(t)}
                    className={cx(
                      'size-12 rounded-full border-2 bg-card p-1',
                      t === theme ? 'border-ink' : 'border-line',
                    )}
                  >
                    <span
                      className="block size-full rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]"
                      style={{ background: THEMES[t].bg }}
                    />
                  </button>
                ))}
              </div>
              <p className="m-0 text-[13px] text-muted">
                {THEMES[theme].note}
              </p>
            </div>

            <p className="m-0 border-t border-line pt-4 text-xs leading-[1.5] text-muted">
              Cards show headlines from his own paper, never a school, a place or a photo. The picture is made in this
              browser and goes only where you send it.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}

function NotReady({ card }: { card: ShareCard }) {
  return (
    <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-card px-8 text-center">
      <span className="font-display text-[26px] font-black">{card.title}</span>
      <span className="text-sm leading-[1.45] text-muted">{card.empty}</span>
    </div>
  )
}

type Prepared = { key: string; file: File }

function ShareActions({ card, theme }: { card: ShareCard; theme: ThemeId }) {
  const key = `${theme}|${JSON.stringify(card)}`
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [status, setStatus] = useState<{ key: string; text: string } | null>(null)
  const [shareable] = useState(canShareFiles)
  const [copyable] = useState(canCopyImage)

  // Make the PNG ahead of the tap: phones only open the share sheet straight from a tap.
  useEffect(() => {
    if (!card.ready) return
    let live = true
    cardPng(card, theme).then((blob) => {
      if (live && blob) setPrepared({ key, file: new File([blob], card.filename, { type: 'image/png' }) })
    })
    return () => {
      live = false
    }
    // `key` covers card and theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const file = prepared?.key === key ? prepared.file : null
  const say = (text: string) => setStatus({ key, text })

  if (!card.ready) {
    return <p className="m-0 text-center text-sm text-muted">{card.empty}</p>
  }

  const onShare = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: card.title })
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') say('That couldn’t be shared. Try Save image instead.')
    }
  }

  const onCopy = async () => {
    if (!file) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })])
      say('Copied. Paste it into a message.')
    } catch {
      say('That couldn’t be copied. Try Save image instead.')
    }
  }

  const onSave = () => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = card.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <div className="mx-auto flex w-full max-w-[400px] flex-col gap-2.5">
      {shareable && (
        <Button variant="primary" className="min-h-12 text-[15px]" disabled={!file} onClick={onShare}>
          <ShareIcon />
          Share…
        </Button>
      )}
      <div className="flex gap-2.5">
        {copyable && (
          <Button className="flex-1" disabled={!file} onClick={onCopy}>
            Copy image
          </Button>
        )}
        <Button variant={shareable ? 'secondary' : 'primary'} className="flex-1" disabled={!file} onClick={onSave}>
          Save image
        </Button>
      </div>
      <p role="status" className="m-0 min-h-5 text-center text-[13px] text-muted">
        {status?.key === key ? status.text : ''}
      </p>
    </div>
  )
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}
