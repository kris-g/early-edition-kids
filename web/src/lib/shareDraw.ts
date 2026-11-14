// Draws the share cards on a 1080 x 1350 canvas: the same drawing makes the on-screen preview and
// the PNG that gets shared. Fonts are the app's self-hosted Inter and Playfair Display.
import { APP_SHORT_NAME } from '../config'
import type { AskCard, MilestoneCard, ShareCard, StreakCard, TodayCard, WeekCard, WordsCard } from './shareCards'

export type ThemeId = 'paper' | 'green' | 'night'
export const THEME_IDS: ThemeId[] = ['paper', 'green', 'night']

export type Palette = {
  bg: string
  panel: string
  ink: string
  muted: string
  accent: string
  /** Text drawn on `accent`. */
  onAccent: string
  /** Muted text drawn on `accent`. */
  onAccentMuted: string
  /** Earlier reading days in the streak strip. */
  soft: string
  warm: string
  line: string
}

export const THEMES: Record<ThemeId, Palette & { label: string; note: string }> = {
  paper: {
    label: 'Paper',
    note: 'Cream, like the Kindle page',
    bg: '#f4f2ec',
    panel: '#ffffff',
    ink: '#171717',
    muted: '#5f5e5a',
    accent: '#0b6b53',
    onAccent: '#ffffff',
    onAccentMuted: '#cfe6dc',
    soft: '#b9dccf',
    warm: '#b45309',
    line: '#c9c4b6',
  },
  green: {
    label: 'Green',
    note: 'The Early Edition green',
    bg: '#0b6b53',
    panel: '#095a46',
    ink: '#ffffff',
    muted: '#cfe6dc',
    accent: '#f6d58a',
    onAccent: '#0b3d2e',
    onAccentMuted: '#5c4a12',
    soft: 'rgba(255,255,255,0.32)',
    warm: '#f6d58a',
    line: 'rgba(255,255,255,0.45)',
  },
  night: {
    label: 'Night',
    note: 'Dark, for dark-mode chats',
    bg: '#111312',
    panel: '#1b1e1c',
    ink: '#f2f0ea',
    muted: '#a9a8a2',
    accent: '#4ade9f',
    onAccent: '#0b1f17',
    onAccentMuted: '#0f3d2a',
    soft: '#2a5a44',
    warm: '#fbbf24',
    line: '#4a504c',
  },
}

export const CARD_W = 1080
export const CARD_H = 1350
const X = 80
const CW = CARD_W - 2 * X
const BOTTOM = CARD_H - 64
const SERIF = '"Playfair Display", Georgia, serif'
const SANS = 'Inter, system-ui, sans-serif'

/** The faces the cards use; load them before drawing or the canvas falls back to Georgia/system fonts. */
export const CARD_FONTS = [
  `800 40px ${SERIF}`,
  `900 40px ${SERIF}`,
  `400 40px ${SANS}`,
  `600 40px ${SANS}`,
  `700 40px ${SANS}`,
]

export async function loadCardFonts(): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts?.load) return
  try {
    await Promise.all(CARD_FONTS.map((f) => fonts.load(f)))
  } catch {
    // draw with fallbacks
  }
}

type C = CanvasRenderingContext2D

type TextStyle = {
  weight: number
  size: number
  family: string
  /** Multiple of size. */
  lh?: number
  color?: string
  /** Pixels, applied where the browser supports canvas letterSpacing. */
  tracking?: number
  align?: CanvasTextAlign
}

function setFont(c: C, s: TextStyle) {
  c.font = `${s.weight} ${s.size}px ${s.family}`
  if ('letterSpacing' in c) (c as C & { letterSpacing: string }).letterSpacing = `${s.tracking ?? 0}px`
  c.textAlign = s.align ?? 'left'
  if (s.color) c.fillStyle = s.color
}

/** Word-wrap `text` to `maxW`; with `maxLines`, the last line ends in "…" if it had to be cut. */
export function wrap(c: C, text: string, maxW: number, maxLines = Infinity): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (line && c.measureText(next).width > maxW) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.includes(' ') && c.measureText(`${last}…`).width > maxW) last = last.slice(0, last.lastIndexOf(' '))
  kept[maxLines - 1] = `${last.replace(/[\s,;:.–-]+$/, '')}…`
  return kept
}

/** Text block from the top at `y` (textBaseline "top"); draws when `draw`, returns its height. */
function text(c: C, s: string, x: number, y: number, maxW: number, style: TextStyle, maxLines = Infinity, draw = true): number {
  setFont(c, style)
  c.textBaseline = 'top'
  const lh = style.size * (style.lh ?? 1.2)
  const lines = wrap(c, s, maxW, maxLines)
  if (draw) lines.forEach((l, i) => c.fillText(l, x, y + i * lh))
  return lines.length ? (lines.length - 1) * lh + style.size : 0
}

/** The largest size in `sizes` at which `s` fits in `maxLines`; returns that style. */
function fit(c: C, s: string, maxW: number, style: TextStyle, sizes: number[], maxLines: number): TextStyle {
  for (const size of sizes) {
    const st = { ...style, size }
    setFont(c, st)
    if (wrap(c, s, maxW).length <= maxLines) return st
  }
  return { ...style, size: sizes.at(-1)! }
}

function rr(c: C, x: number, y: number, w: number, h: number, r: number | [number, number, number, number]) {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r
  c.beginPath()
  c.moveTo(x + tl, y)
  c.arcTo(x + w, y, x + w, y + h, tr)
  c.arcTo(x + w, y + h, x, y + h, br)
  c.arcTo(x, y + h, x, y, bl)
  c.arcTo(x, y, x + w, y, tl)
  c.closePath()
}

function fillRR(c: C, x: number, y: number, w: number, h: number, r: number | [number, number, number, number], color: string) {
  rr(c, x, y, w, h, r)
  c.fillStyle = color
  c.fill()
}

function logo(c: C, x: number, y: number, size: number, color: string) {
  c.save()
  c.translate(x, y)
  c.scale(size / 48, size / 48)
  c.strokeStyle = color
  c.fillStyle = color
  c.lineWidth = 3.5
  c.lineCap = 'round'
  c.stroke(new Path2D('M6 36h36'))
  c.fill(new Path2D('M13 36a11 11 0 0 1 22 0z'))
  c.stroke(new Path2D('M24 12v6M10.5 18.5l4 4M37.5 18.5l-4 4'))
  c.restore()
}

/** Logo, title and date over a double rule. Returns the y below it. */
function masthead(c: C, p: Palette, dateLabel: string): number {
  logo(c, X - 6, 50, 76, p.accent)
  text(c, APP_SHORT_NAME, X + 82, 80, 560, { weight: 800, size: 46, family: SERIF, color: p.ink, lh: 1 })
  setFont(c, { weight: 600, size: 24, family: SANS, color: p.muted, tracking: 3, align: 'right' })
  c.textBaseline = 'alphabetic'
  c.fillText(dateLabel, CARD_W - X, 112)
  c.fillStyle = p.ink
  c.fillRect(X, 152, CW, 2)
  c.fillRect(X, 158, CW, 2)
  return 160
}

function kicker(c: C, p: Palette, s: string, y: number, align: CanvasTextAlign = 'left') {
  const x = align === 'center' ? CARD_W / 2 : X
  text(c, s, x, y, CW, { weight: 700, size: 28, family: SANS, color: p.warm, tracking: 5.6, align })
}

function background(c: C, p: Palette) {
  c.fillStyle = p.bg
  c.fillRect(0, 0, CARD_W, CARD_H)
}

// ---- cards ----

function drawStreak(c: C, card: StreakCard, p: Palette) {
  kicker(c, p, 'READING STREAK', 236)
  const digits = String(card.count).length
  const size = digits <= 1 ? 400 : digits === 2 ? 330 : 250
  const base = 300 + size * 0.72
  setFont(c, { weight: 900, size, family: SERIF, color: p.ink })
  c.textBaseline = 'alphabetic'
  c.fillText(String(card.count), X - size * 0.03, base)
  const numW = c.measureText(String(card.count)).width
  setFont(c, { weight: 800, size: 86, family: SERIF, color: p.ink })
  c.fillText(card.count === 1 ? 'day' : 'days', X + numW + 24, base - 96)
  c.fillText('in a row', X + numW + 24, base - 8)

  text(c, card.sentence, X, base + 112, 880, { weight: 400, size: 42, family: SANS, color: p.ink, lh: 1.3 }, 2)

  // 14-day strip
  const top = 900
  const box = 58
  const gap = (CW - card.days.length * box) / Math.max(1, card.days.length - 1)
  card.days.forEach((d, i) => {
    const x = X + i * (box + gap)
    if (d.state === 'missed' || d.state === 'pending') {
      c.save()
      c.setLineDash(d.state === 'missed' ? [8, 6] : [])
      c.lineWidth = 3
      c.strokeStyle = p.line
      rr(c, x + 1.5, top + 1.5, box - 3, box - 3, 12)
      c.stroke()
      c.restore()
    } else fillRR(c, x, top, box, box, 12, d.state === 'current' ? p.accent : p.soft)
    text(c, d.letter, x + box / 2, top + box + 12, box, { weight: 600, size: 22, family: SANS, color: p.muted, align: 'center' })
  })
  const labels = { weight: 400, size: 22, family: SANS, color: p.muted }
  text(c, card.fromLabel, X, top + box + 50, 300, labels)
  text(c, card.missedNote, CARD_W / 2, top + box + 50, 400, { ...labels, align: 'center' })
  text(c, 'Today', CARD_W - X, top + box + 50, 300, { ...labels, align: 'right' })

  // two panels
  const ph = 150
  const py = BOTTOM - ph
  const pw = (CW - 20) / 2
  const panel = (x: number, big: string, small: string, caption: string) => {
    fillRR(c, x, py, pw, ph, 22, p.panel)
    setFont(c, { weight: 800, size: 64, family: SERIF, color: p.ink })
    c.textBaseline = 'alphabetic'
    c.fillText(big, x + 32, py + 82)
    const bw = c.measureText(big).width
    setFont(c, { weight: 800, size: 36, family: SERIF, color: p.ink })
    c.fillText(small, x + 32 + bw + 10, py + 82)
    text(c, caption, x + 32, py + 98, pw - 64, { weight: 400, size: 26, family: SANS, color: p.muted }, 1)
  }
  panel(X, String(card.daysRead), `of ${card.days.length} days`, 'read in the last fortnight')
  panel(X + pw + 20, String(card.longest), card.longest === 1 ? 'day' : 'days', 'longest streak so far')
}

function checkMark(c: C, cx: number, cy: number, r: number, p: Palette) {
  c.beginPath()
  c.arc(cx, cy, r, 0, Math.PI * 2)
  c.fillStyle = p.accent
  c.fill()
  c.save()
  c.translate(cx - r, cy - r)
  c.scale((2 * r) / 32, (2 * r) / 32)
  c.strokeStyle = p.onAccent
  c.lineWidth = 3
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.stroke(new Path2D('M9.5 16.5l4.2 4.2 8.8-9.2'))
  c.restore()
}

function drawToday(c: C, card: TodayCard, p: Palette) {
  kicker(c, p, 'TODAY', 236)
  const hs = fit(c, card.headline, CW, { weight: 900, size: 120, family: SERIF, color: p.ink, lh: 0.98 }, [120, 108, 96, 84], 2)
  let y = 280 + text(c, card.headline, X, 280, CW, hs, 2) + 40

  // chips
  let cx = X
  for (const chip of card.chips) {
    setFont(c, { weight: 600, size: 28, family: SANS })
    const w = c.measureText(chip).width + 44
    if (cx + w > X + CW) break
    fillRR(c, cx, y, w, 56, 28, p.panel)
    text(c, chip, cx + 22, y + 14, w, { weight: 600, size: 28, family: SANS, color: p.ink, lh: 1 })
    cx += w + 14
  }
  y += 56

  // stories, anchored to the bottom
  const titleW = CW - 64 - 92
  const configs = [
    { size: 46, lines: 2 },
    { size: 40, lines: 2 },
    { size: 36, lines: 1 },
  ]
  const moreH = card.more ? 44 : 0
  for (const cfg of configs) {
    const title = { weight: 800, size: cfg.size, family: SERIF, color: p.ink, lh: 1.08 }
    const heights = card.stories.map((s) => 28 + 22 + 12 + text(c, s.title, 0, 0, titleW, title, cfg.lines, false) + 28)
    const total = heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * 18 + moreH
    if (BOTTOM - total < y + 40 && cfg !== configs.at(-1)) continue
    let ry = BOTTOM - total
    card.stories.forEach((s, i) => {
      fillRR(c, X, ry, CW, heights[i], 22, p.panel)
      text(c, s.topic.toUpperCase(), X + 32, ry + 28, titleW, { weight: 700, size: 22, family: SANS, color: p.accent, tracking: 3 }, 1)
      text(c, s.title, X + 32, ry + 28 + 22 + 12, titleW, title, cfg.lines)
      checkMark(c, X + CW - 32 - 32, ry + heights[i] / 2, 32, p)
      ry += heights[i] + 18
    })
    if (card.more) text(c, `+ ${card.more} more`, X, BOTTOM - 30, CW, { weight: 600, size: 28, family: SANS, color: p.muted })
    break
  }
}

function drawWeek(c: C, card: WeekCard, p: Palette) {
  kicker(c, p, 'THE WEEK IN NEWS', 236)
  const hs = fit(c, card.headline, CW, { weight: 900, size: 112, family: SERIF, color: p.ink, lh: 0.98 }, [112, 100, 88], 2)
  const y = 280 + text(c, card.headline, X, 280, CW, hs, 2) + 44

  const pw = (CW - 36) / 3
  const stat = (i: number, big: string, small: string, caption: string) => {
    const x = X + i * (pw + 18)
    fillRR(c, x, y, pw, 168, 22, p.panel)
    setFont(c, { weight: 900, size: 92, family: SERIF, color: p.ink })
    c.textBaseline = 'alphabetic'
    c.fillText(big, x + 28, y + 100)
    if (small) {
      const bw = c.measureText(big).width
      setFont(c, { weight: 900, size: 48, family: SERIF, color: p.ink })
      c.fillText(small, x + 28 + bw + 4, y + 100)
    }
    text(c, caption, x + 28, y + 118, pw - 56, { weight: 400, size: 26, family: SANS, color: p.muted }, 1)
  }
  stat(0, String(card.stories), '', card.stories === 1 ? 'story' : 'stories')
  stat(1, String(card.minutes), '', card.minutes === 1 ? 'minute reading' : 'minutes reading')
  stat(2, String(card.daysRead), '/7', 'days')

  // bars, anchored to the bottom
  const topicsY = BOTTOM - 38
  const lettersY = card.topics.length ? topicsY - 70 : BOTTOM - 30
  const baseY = lettersY - 16
  const n = card.bars.length
  const gap = 22
  const bw = (CW - gap * (n - 1)) / n
  const max = Math.max(1, ...card.bars.map((b) => b.read))
  const room = Math.min(330, baseY - (y + 168) - 90)
  card.bars.forEach((b, i) => {
    const x = X + i * (bw + gap)
    const h = b.read ? Math.max(10, Math.round((b.read / max) * room)) : 0
    if (h) fillRR(c, x, baseY - h, bw, h, [14, 14, 0, 0], p.accent)
    text(c, String(b.read), x + bw / 2, baseY - h - 42, bw, { weight: 700, size: 30, family: SANS, color: b.read ? p.ink : p.muted, align: 'center' })
    text(c, b.letter, x + bw / 2, lettersY, bw, { weight: 600, size: 24, family: SANS, color: p.muted, align: 'center' })
  })
  c.fillStyle = p.line
  c.fillRect(X, baseY, CW, 3)

  if (card.topics.length) {
    const label = 'Favourite topics: '
    const list = card.topics.length === 1 ? card.topics[0] : `${card.topics.slice(0, -1).join(', ')} and ${card.topics.at(-1)}`
    let size = 30
    for (; size > 22; size -= 2) {
      setFont(c, { weight: 400, size, family: SANS })
      const a = c.measureText(label).width
      setFont(c, { weight: 700, size, family: SANS })
      if (a + c.measureText(list).width <= CW) break
    }
    setFont(c, { weight: 400, size, family: SANS, color: p.ink })
    c.textBaseline = 'top'
    c.fillText(label, X, topicsY)
    const a = c.measureText(label).width
    text(c, list, X + a, topicsY, CW - a, { weight: 700, size, family: SANS, color: p.ink }, 1)
  }
}

function drawMilestone(c: C, card: MilestoneCard, p: Palette) {
  kicker(c, p, 'MILESTONE', 214, 'center')
  const cx = CARD_W / 2
  const cy = 516
  c.save()
  c.strokeStyle = p.warm
  c.lineWidth = 8
  c.lineCap = 'round'
  c.beginPath()
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2
    const r2 = i % 2 ? 252 : 270
    c.moveTo(cx + Math.cos(a) * 226, cy + Math.sin(a) * 226)
    c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
  }
  c.stroke()
  c.beginPath()
  c.arc(cx, cy, 200, 0, Math.PI * 2)
  c.fillStyle = p.accent
  c.fill()
  c.setLineDash([2, 12])
  c.lineWidth = 3
  c.strokeStyle = p.onAccent
  c.beginPath()
  c.arc(cx, cy, 178, 0, Math.PI * 2)
  c.stroke()
  c.restore()

  const digits = String(card.stories).length
  const size = digits <= 2 ? 210 : digits === 3 ? 160 : 120
  setFont(c, { weight: 900, size, family: SERIF, color: p.onAccent, align: 'center' })
  c.textBaseline = 'alphabetic'
  c.fillText(String(card.stories), cx, cy + size * 0.3)
  text(c, 'STORIES', cx, cy + size * 0.3 + 28, 300, { weight: 700, size: 30, family: SANS, color: p.onAccent, tracking: 5.4, align: 'center' })

  const hs = fit(c, card.headline, CW, { weight: 900, size: 108, family: SERIF, color: p.ink, lh: 1, align: 'center' }, [108, 96, 84, 72], 1)
  let y = 830 + text(c, card.headline, cx, 830, CW, hs, 1) + 30
  y += text(c, card.sentence, cx, y, 860, { weight: 400, size: 38, family: SANS, color: p.ink, lh: 1.3, align: 'center' }, 2) + 16
  if (card.storyTitle) {
    text(c, `“${card.storyTitle}”`, cx, y, 860, { weight: 800, size: 44, family: SERIF, color: p.ink, lh: 1.15, align: 'center' }, 2)
  }
  text(c, `Next stop: ${card.next} stories`, cx, BOTTOM - 30, CW, { weight: 400, size: 26, family: SANS, color: p.muted, align: 'center' })
}

function drawWords(c: C, card: WordsCard, p: Palette) {
  kicker(c, p, 'WORDS TO KNOW', 236)
  const hs = fit(c, card.headline, CW, { weight: 900, size: 104, family: SERIF, color: p.ink, lh: 0.98 }, [104, 92, 80], 2)
  const y = 280 + text(c, card.headline, X, 280, CW, hs, 2) + 40

  const configs = [
    { word: 62, def: 32, lines: 2, pad: 26 },
    { word: 54, def: 30, lines: 2, pad: 20 },
    { word: 48, def: 28, lines: 1, pad: 16 },
  ]
  for (const cfg of configs) {
    const def = { weight: 400, size: cfg.def, family: SANS, color: p.ink, lh: 1.3 }
    const heights = card.words.map((w) => cfg.pad + cfg.word + 10 + text(c, w.definition, 0, 0, CW, def, cfg.lines, false) + 10 + 24 + cfg.pad)
    const total = heights.reduce((a, b) => a + b, 0)
    if (BOTTOM - total < y && cfg !== configs.at(-1)) continue
    let ry = BOTTOM - total
    card.words.forEach((w, i) => {
      c.fillStyle = p.line
      c.fillRect(X, ry, CW, 2)
      let ty = ry + cfg.pad
      ty += text(c, w.word, X, ty, CW, { weight: 800, size: cfg.word, family: SERIF, color: p.accent, lh: 1 }, 1) + 10
      ty += text(c, w.definition, X, ty, CW, def, cfg.lines) + 10
      text(c, `from “${w.story_title}”`, X, ty, CW, { weight: 400, size: 22, family: SANS, color: p.muted }, 1)
      ry += heights[i]
    })
    break
  }
}

function drawAsk(c: C, card: AskCard, p: Palette) {
  kicker(c, p, 'NEXT TIME YOU CALL', 236)
  const hs = fit(c, card.headline, CW, { weight: 900, size: 128, family: SERIF, color: p.ink, lh: 0.95 }, [128, 112, 96], 2)
  const y = 280 + text(c, card.headline, X, 280, CW, hs, 2) + 40

  const footerY = BOTTOM - 34
  text(c, card.footer, X, footerY, CW, { weight: 400, size: 28, family: SANS, color: p.muted }, 1)

  const maxW = 760
  const inner = maxW - 68
  const configs = [
    { size: 42, lines: 2 },
    { size: 36, lines: 2 },
    { size: 32, lines: 1 },
  ]
  for (const cfg of configs) {
    const q = { weight: 600, size: cfg.size, family: SANS, lh: 1.2 }
    const heights = card.stories.map((s) => 28 + 22 + 10 + text(c, s.title, 0, 0, inner, q, cfg.lines, false) + 28)
    const total = heights.reduce((a, b) => a + b, 0) + (heights.length - 1) * 26
    const bottom = footerY - 40
    if (bottom - total < y && cfg !== configs.at(-1)) continue
    let ry = bottom - total
    card.stories.forEach((s, i) => {
      setFont(c, q)
      const lines = wrap(c, s.title, inner, cfg.lines)
      let w = Math.max(...lines.map((l) => c.measureText(l).width))
      setFont(c, { weight: 700, size: 22, family: SANS, tracking: 3 })
      w = Math.min(maxW, Math.max(w, c.measureText(s.topic.toUpperCase()).width) + 68)
      const right = i % 2 === 1
      const filled = i === 1
      const bx = right ? X + CW - w : X
      fillRR(c, bx, ry, w, heights[i], right ? [36, 36, 8, 36] : [36, 36, 36, 8], filled ? p.accent : p.panel)
      text(c, s.topic.toUpperCase(), bx + 34, ry + 28, inner, { weight: 700, size: 22, family: SANS, color: filled ? p.onAccentMuted : p.accent, tracking: 3 }, 1)
      text(c, s.title, bx + 34, ry + 28 + 22 + 10, inner, { ...q, color: filled ? p.onAccent : p.ink }, cfg.lines)
      ry += heights[i] + 26
    })
    break
  }
}

/** Draw `card` on a 1080 x 1350 context. */
export function drawCard(c: C, card: ShareCard, theme: ThemeId): void {
  const p = THEMES[theme]
  c.save()
  background(c, p)
  masthead(c, p, card.dateLabel)
  switch (card.id) {
    case 'streak':
      drawStreak(c, card, p)
      break
    case 'today':
      drawToday(c, card, p)
      break
    case 'week':
      drawWeek(c, card, p)
      break
    case 'milestone':
      drawMilestone(c, card, p)
      break
    case 'words':
      drawWords(c, card, p)
      break
    case 'ask':
      drawAsk(c, card, p)
      break
  }
  c.restore()
}

/** The card as a PNG, or null where canvas isn't available (tests, very old browsers). */
export async function cardPng(card: ShareCard, theme: ThemeId): Promise<Blob | null> {
  await loadCardFonts()
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  let c: C | null
  try {
    c = canvas.getContext('2d')
  } catch {
    c = null
  }
  if (!c) return null
  drawCard(c, card, theme)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}
