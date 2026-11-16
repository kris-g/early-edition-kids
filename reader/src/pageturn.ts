// A page turn like Apple Books: the corner of the page curls back towards the spine along a
// diagonal fold, showing the back of the page, with soft shading at the fold. It can follow a
// finger (setProgress, then release) or play on its own (a tap or a key).
//
// The pages are columns of one long strip (#flow), so every face drawn here is a copy of that
// strip cut to one column. The real strip underneath shows the page being turned to.
//
// Geometry, in the turning page's own coordinates (x from the spine, y down, width w, height H):
// the corner C sits at (w, cy). Dragging it to P folds the page along the perpendicular
// bisector of C-P. What lies on the corner's side of that line is lifted off (showing the page
// underneath) and reappears, reflected across the line, as the flap.

export interface PageTurnOptions {
  pager: HTMLElement
  flow: HTMLElement
  from: number
  to: number
  /** 2 on its side (a spread), 1 upright. */
  cols: number
  /** Which corner curls: the bottom one unless the finger started near the top. */
  corner?: 'top' | 'bottom'
  /** Milliseconds for a whole turn played on its own. */
  duration?: number
}

interface Pt {
  x: number
  y: number
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const len = (a: Pt) => Math.hypot(a.x, a.y)

/** The part of a convex polygon on one side of the line n·p = d (Sutherland-Hodgman, one edge). */
export function clipPolygon(poly: Pt[], n: Pt, d: number, keep: 'below' | 'above'): Pt[] {
  const inside = (p: Pt) => (keep === 'below' ? dot(n, p) <= d : dot(n, p) >= d)
  const out: Pt[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ia = inside(a)
    const ib = inside(b)
    if (ia) out.push(a)
    if (ia !== ib) {
      const t = (d - dot(n, a)) / dot(n, sub(b, a))
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

/** Where the curling corner is at progress p (0 flat, 1 turned over), kept attached to the spine. */
export function cornerAt(p: number, w: number, h: number, top: boolean): Pt {
  const cy = top ? 0 : h
  const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, p))) * h * 0.14
  let pt: Pt = { x: w - 2 * w * p, y: top ? cy + lift : cy - lift }
  // A page can't stretch: the corner stays within reach of the spine at both edges.
  const near: Pt = { x: 0, y: cy }
  const far: Pt = { x: 0, y: h - cy }
  const d1 = len(sub(pt, near))
  if (d1 > w) pt = { x: near.x + ((pt.x - near.x) * w) / d1, y: near.y + ((pt.y - near.y) * w) / d1 }
  const diag = Math.hypot(w, h)
  const d2 = len(sub(pt, far))
  if (d2 > diag) pt = { x: far.x + ((pt.x - far.x) * diag) / d2, y: far.y + ((pt.y - far.y) * diag) / d2 }
  return pt
}

const poly = (pts: Pt[], dx: number) => (pts.length < 3 ? 'polygon(0 0, 0 0, 0 0)' : `polygon(${pts.map((p) => `${(p.x + dx).toFixed(2)}px ${p.y.toFixed(2)}px`).join(', ')})`)

/** One page (column) of the strip, as a picture of that page. */
function face(flow: HTMLElement, page: number, col: number, colWidth: number, stripWidth: number, height: number): HTMLElement {
  const box = document.createElement('div')
  box.className = 'curl-face'
  Object.assign(box.style, { width: `${colWidth}px`, height: `${height}px` })
  const copy = flow.cloneNode(true) as HTMLElement
  copy.removeAttribute('id')
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
  copy.classList.remove('turning')
  copy.setAttribute('aria-hidden', 'true')
  // `inset` first: the strip's own rule pins all four edges, and a later `inset` would undo top/left.
  Object.assign(copy.style, {
    inset: 'auto',
    position: 'absolute',
    top: '0',
    left: `${-col * colWidth}px`,
    width: `${stripWidth}px`,
    height: `${height}px`,
    transition: 'none',
    transform: `translateX(${-page * stripWidth}px)`,
  })
  box.appendChild(copy)
  return box
}

/** A long bar whose left edge lies on the fold, pointing along `dir`, to carry a shading gradient. */
function shadeBar(cls: string): HTMLElement {
  const bar = document.createElement('div')
  bar.className = `curl-bar ${cls}`
  return bar
}

function placeBar(bar: HTMLElement, at: Pt, dir: Pt, reach: number, gradient: string): void {
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
  Object.assign(bar.style, {
    width: `${reach * 2}px`,
    height: `${reach * 2}px`,
    transform: `translate(${at.x}px, ${at.y}px) rotate(${angle}deg) translate(0, ${-reach}px)`,
    background: gradient,
  })
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export class PageTurn {
  readonly forward: boolean
  /** Resolves true when the page turned, false when the reader let it fall back. */
  readonly done: Promise<boolean>
  private readonly layer: HTMLElement
  private readonly flow: HTMLElement
  private readonly stripWidth: number
  private readonly w: number
  private readonly h: number
  private readonly spine: number
  private readonly spread: boolean
  private readonly top: boolean
  private readonly duration: number
  private readonly from: number
  private readonly to: number
  private readonly front: HTMLElement
  private readonly under: HTMLElement
  private readonly flapClip: HTMLElement
  private readonly back: HTMLElement
  private readonly underBar: HTMLElement
  private readonly frontBar: HTMLElement
  private readonly flapBar: HTMLElement
  /** Leaf progress: 0 lies flat on the right, 1 has turned over to the spine's other side. */
  private p = 0
  private frame = 0
  private resolve!: (turned: boolean) => void
  private settled = false

  constructor(o: PageTurnOptions) {
    this.flow = o.flow
    this.from = o.from
    this.to = o.to
    this.forward = o.to > o.from
    this.top = o.corner === 'top'
    this.duration = o.duration ?? 720
    this.done = new Promise((r) => (this.resolve = r))
    this.stripWidth = o.pager.clientWidth
    this.h = o.pager.clientHeight
    this.spread = o.cols >= 2
    this.w = this.spread ? this.stripWidth / 2 : this.stripWidth
    this.spine = this.spread ? this.w : 0

    // The leaf always turns from right to left. Turning back is the same turn played in
    // reverse, with the pages swapped: x lies flat at the start, y is revealed underneath.
    const x = this.forward ? o.from : o.to
    const y = this.forward ? o.to : o.from
    const W = this.stripWidth
    const H = this.h

    this.layer = document.createElement('div')
    this.layer.className = 'curl-layer'

    // A spread: the left-hand page stays put while the right-hand one turns over it.
    if (this.spread) {
      const still = face(o.flow, x, 0, this.w, W, H)
      still.style.left = '0'
      this.layer.appendChild(still)
    }

    // What the lifted corner reveals is the real strip, set to page y; this draws its shadow.
    this.under = document.createElement('div')
    this.under.className = 'curl-clip'
    this.underBar = shadeBar('curl-under-shade')
    this.under.appendChild(this.underBar)
    this.layer.appendChild(this.under)

    // The page being turned, minus its lifted corner.
    this.front = document.createElement('div')
    this.front.className = 'curl-clip'
    const frontFace = face(o.flow, x, this.spread ? 1 : 0, this.w, W, H)
    frontFace.style.left = `${this.spine}px`
    this.front.appendChild(frontFace)
    this.frontBar = shadeBar('curl-front-shade')
    this.front.appendChild(this.frontBar)
    this.layer.appendChild(this.front)

    // The flap: the back of the lifted corner. On a spread its back is the next left-hand page;
    // upright, it is the same page seen through the paper, faint and mirrored.
    const flapWrap = document.createElement('div')
    flapWrap.className = 'curl-flap'
    this.flapClip = document.createElement('div')
    this.flapClip.className = 'curl-clip'
    this.back = this.spread ? face(o.flow, y, 0, this.w, W, H) : face(o.flow, x, 0, this.w, W, H)
    this.back.classList.add('curl-back')
    this.flapClip.appendChild(this.back)
    if (!this.spread) {
      const wash = document.createElement('div')
      wash.className = 'curl-wash'
      this.flapClip.appendChild(wash)
    }
    this.flapBar = shadeBar('curl-flap-shade')
    this.flapClip.appendChild(this.flapBar)
    flapWrap.appendChild(this.flapClip)
    this.layer.appendChild(flapWrap)

    o.pager.appendChild(this.layer)
    this.setStrip(y)
    this.p = this.forward ? 0 : 1
    this.draw()
  }

  /** Follow a finger: 0 is where the page started, 1 is fully turned. */
  setProgress(t: number): void {
    cancelAnimationFrame(this.frame)
    const c = Math.max(0, Math.min(1, t))
    this.p = this.forward ? c : 1 - c
    this.draw()
  }

  /** Play on to the end, or back to the start when the turn is let go. */
  release(turn: boolean): void {
    const target = turn === this.forward ? 1 : 0
    const start = this.p
    const span = Math.abs(target - start)
    if (span < 0.001) return this.settle(turn)
    const fromRest = start === (this.forward ? 0 : 1)
    const ms = Math.max(160, this.duration * span)
    const t0 = performance.now()
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      const e = fromRest ? easeInOut(k) : easeOut(k)
      this.p = start + (target - start) * e
      this.draw()
      if (k < 1) this.frame = requestAnimationFrame(step)
      else this.settle(turn)
    }
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(step)
  }

  /** Jump to the end now (another turn was asked for before this one finished). */
  finishNow(): void {
    if (this.settled) return
    cancelAnimationFrame(this.frame)
    this.settle(this.forward ? this.p >= 0.5 : this.p <= 0.5)
  }

  private draw(): void {
    const w = this.w
    const H = this.h
    const s = this.spine
    const page: Pt[] = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: H },
      { x: 0, y: H },
    ]
    const C: Pt = { x: w, y: this.top ? 0 : H }
    const P = cornerAt(this.p, w, H, this.top)
    const gap = len(sub(C, P))
    if (gap < 0.5) {
      this.front.style.clipPath = poly(page, s)
      this.under.style.clipPath = poly([], s)
      this.flapClip.style.clipPath = poly([], s)
      return
    }
    // The fold: through the midpoint of C and P, with n pointing towards the corner.
    const n: Pt = { x: (C.x - P.x) / gap, y: (C.y - P.y) / gap }
    const M: Pt = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 }
    const d = dot(n, M)
    const kept = clipPolygon(page, n, d, 'below')
    const lifted = clipPolygon(page, n, d, 'above')
    const reflect = (p: Pt): Pt => {
      const k = 2 * (dot(n, p) - d)
      return { x: p.x - k * n.x, y: p.y - k * n.y }
    }
    const flap = lifted.map(reflect)
    const depth = Math.max(1, ...lifted.map((p) => dot(n, p) - d))

    this.front.style.clipPath = poly(kept, s)
    this.under.style.clipPath = poly(lifted, s)
    this.flapClip.style.clipPath = poly(flap, s)

    // The back of the page: reflect it across the fold. On a spread its picture is first mirrored
    // across the spine, since the next left-hand page lies face down on this one.
    const a = 1 - 2 * n.x * n.x
    const b = -2 * n.x * n.y
    const dd = 1 - 2 * n.y * n.y
    // Reflection R(p) = A p + t, in the screen's coordinates (spine at x = s).
    const ms: Pt = { x: M.x + s, y: M.y }
    const k = 2 * dot(n, ms)
    const tx = k * n.x
    const ty = k * n.y
    if (this.spread) {
      // R(mirror(p)), mirror(p) = (2s - x, y).
      this.back.style.transform = `matrix(${-a}, ${-b}, ${b}, ${dd}, ${a * 2 * s + tx}, ${b * 2 * s + ty})`
    } else {
      this.back.style.transform = `matrix(${a}, ${b}, ${b}, ${dd}, ${tx}, ${ty})`
    }

    const fold: Pt = { x: M.x + s, y: M.y }
    const reach = Math.hypot(this.stripWidth, H)
    const into: Pt = { x: n.x, y: n.y }
    const away: Pt = { x: -n.x, y: -n.y }
    const shadow = Math.min(90, depth * 0.9)
    // The revealed page darkens where the leaf lifts off it.
    placeBar(this.underBar, fold, into, reach, `linear-gradient(to right, rgba(18,18,18,0.32), rgba(18,18,18,0) ${shadow}px)`)
    // The page still lying flat catches the flap's shadow just past the fold.
    placeBar(this.frontBar, fold, away, reach, `linear-gradient(to right, rgba(18,18,18,0.14), rgba(18,18,18,0) ${Math.min(60, depth * 0.6)}px, rgba(18,18,18,0) ${depth}px, rgba(18,18,18,0.12) ${depth + 18}px, rgba(18,18,18,0) ${depth + 70}px)`)
    // The flap is rounded where it bends: dark in the crease, bright on the curve, shading off.
    placeBar(this.flapBar, fold, away, reach, `linear-gradient(to right, rgba(18,18,18,0.22), rgba(255,255,255,0.32) ${depth * 0.22}px, rgba(255,255,255,0.05) ${depth * 0.6}px, rgba(18,18,18,0.10) ${depth}px)`)
  }

  private setStrip(page: number): void {
    this.flow.classList.remove('turning')
    this.flow.style.transform = `translateX(${-page * this.stripWidth}px)`
  }

  private settle(turned: boolean): void {
    if (this.settled) return
    this.settled = true
    cancelAnimationFrame(this.frame)
    this.setStrip(turned ? this.to : this.from)
    this.layer.remove()
    this.resolve(turned)
  }
}
