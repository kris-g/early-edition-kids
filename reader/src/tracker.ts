// Active reading time and pages for one open story, as the Kindle plugin measures it
// (plugin/.../tracker.lua). Time while the page is hidden or the iPad sleeps is not counted:
// the app calls pause() and resume(). The time between two interactions (opening, a page turn,
// scrolling, coming back) is capped, so a story left open on the table is not an hour of reading.

export const MAX_GAP_SECONDS = 300

export interface StoryFigures {
  active_seconds: number
  pages_total: number
  max_page: number
  finished: boolean
}

export interface TrackerState {
  active: number
  maxPage: number
  pagesTotal: number | null
  reachedEnd: boolean
}

export class Tracker {
  private clock: () => number
  private maxGap: number
  active = 0
  private last: number
  paused = false
  maxPage = 0
  pagesTotal: number | null = null
  reachedEnd = false

  /** `clock` returns seconds (fractions allowed). */
  constructor(clock: () => number = () => Date.now() / 1000, maxGap = MAX_GAP_SECONDS, from?: TrackerState) {
    this.clock = clock
    this.maxGap = maxGap
    this.last = clock()
    if (from) {
      this.active = from.active
      this.maxPage = from.maxPage
      this.pagesTotal = from.pagesTotal
      this.reachedEnd = from.reachedEnd
    }
  }

  tick(): void {
    if (this.paused) return
    const now = this.clock()
    const d = Math.min(Math.max(0, now - this.last), this.maxGap)
    this.active += d
    this.last = now
  }

  pause(): void {
    if (this.paused) return
    this.tick()
    this.paused = true
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.last = this.clock()
  }

  /** A page (1-based) of `total` was shown. Returns true on the last page. */
  page(pageNo: number, total: number): boolean {
    this.tick()
    if (total > 0) this.pagesTotal = total
    if (pageNo > this.maxPage) this.maxPage = pageNo
    return this.pagesTotal !== null && this.maxPage >= this.pagesTotal
  }

  /** The reader turned on from the last page, or the end of the story came into view. */
  markEnd(total?: number): void {
    this.tick()
    if (total && total > 0) this.pagesTotal = total
    this.reachedEnd = true
  }

  state(): TrackerState {
    this.tick()
    return { active: this.active, maxPage: this.maxPage, pagesTotal: this.pagesTotal, reachedEnd: this.reachedEnd }
  }

  /** The story_closed payload. */
  result(total?: number): StoryFigures {
    this.tick()
    const pagesTotal = total && total > 0 ? total : this.pagesTotal ?? Math.max(this.maxPage, 1)
    // A turn of the iPad re-lays the pages; reaching the end still counts.
    let maxPage = this.reachedEnd ? pagesTotal : Math.min(this.maxPage, pagesTotal)
    // As on the Kindle, the last page shown is the end of the story.
    const finished = this.reachedEnd || (this.maxPage > 0 && maxPage === pagesTotal)
    if (maxPage < 1) maxPage = 1
    return {
      active_seconds: Math.round(this.active),
      pages_total: pagesTotal,
      max_page: finished ? pagesTotal : Math.min(maxPage, Math.max(1, pagesTotal - 1)),
      finished,
    }
  }
}
