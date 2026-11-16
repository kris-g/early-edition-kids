// The reader itself: which screen is up, reading a story in pages or as one long paper, and
// recording reading the way the Kindle does (CONTRACT.md "POST /api/events"). The look and the
// behaviour follow the approved mock-up in docs/mockups/ipad-reader/.

import { ApiError, getIssue, getSettings, getStoryHtml, joinMount } from './api'
import { parseStoryHtml } from './body'
import { addDays, isIsoDate, londonDate, nowSeconds } from './clock'
import { EventQueue } from './events'
import { Library } from './library'
import { SIZES, applyLook, readLook, type Look, type Theme } from './look'
import { ReadingLog, myWeek } from './readlog'
import { Store, browserKV, deviceId, namespaceFor, uuid, type KV } from './storage'
import { Tracker, type TrackerState } from './tracker'
import type { ApiStory, Issue, ReaderMode, ReaderSettings, StoryBody } from './types'
import { PageTurn } from './pageturn'
import { Uploader } from './uploader'
import {
  backIssuesHtml,
  finishedHtml,
  frontHtml,
  loadingHtml,
  longHtml,
  lookHtml,
  myWeekHtml,
  pagedHtml,
  place,
  tally,
  waitingHtml,
  type BackIssueRow,
  type DatelineStatus,
  type ViewCtx,
} from './views'

type Screen = 'loading' | 'waiting' | 'front' | 'story' | 'backissues' | 'myweek'

/** Check for news again when the reader comes back after this long (the Kindle's rule 3). */
export const RECHECK_SECONDS = 30 * 60
/** In the long paper, a story counts as opened once it has been on screen this long. */
const SCROLL_OPEN_MS = 2000
const UPLOAD_DELAY_MS = 3000
const BACK_ISSUE_DAYS = 7

/** The type size band for a reader's age, as in the mock-up. */
export const ageClass = (age: number) => (age <= 6 ? 'age-young' : age >= 9 ? 'age-older' : 'age-mid')

interface OpenStory {
  storyId: number
  date: string
  topic: string
  title: string
  word: string | null
  definition: string | null
  /** Pages (or screens, in the long paper) when known. */
  total: number | null
  tracker: Tracker
}

interface SessionRecord extends Omit<OpenStory, 'tracker'> {
  tracker: TrackerState
}

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)

/**
 * How many pages a story laid out in columns takes. Safari leaves overflowing columns out of
 * scrollWidth, so measure where the furthest block actually ends as well and take the larger.
 */
export function pageCount(flow: HTMLElement, pageWidth: number): number {
  const left = flow.getBoundingClientRect().left
  let extent = flow.scrollWidth
  for (const el of Array.from(flow.children)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 || r.height > 0) extent = Math.max(extent, r.right - left)
  }
  return Math.max(1, Math.ceil(extent / pageWidth - 0.02))
}

export interface ReaderOptions {
  app: HTMLElement
  stage: HTMLElement
  kv?: KV
  pathname?: string
}

export class ReaderApp {
  readonly app: HTMLElement
  readonly stage: HTMLElement
  readonly store: Store
  readonly library: Library
  readonly queue: EventQueue
  readonly log: ReadingLog
  readonly uploader: Uploader
  settings: ReaderSettings
  /** Text size and page colour, chosen from the Aa button on a story. */
  look: Look
  lookOpen = false

  screen: Screen = 'loading'
  /** The paper on show: today's, or a back issue. */
  issue: Issue | null = null
  viewingToday = true
  todayStatus: 'unknown' | 'ok' | 'not_ready' | 'offline' = 'unknown'
  checking = false
  /** A newer copy of today's paper that arrived while a story was open; shown on the way back. */
  private pendingToday: Issue | null = null
  mode: ReaderMode = 'pages'
  story = 0
  page = 0
  pages = 1
  /** The page turn under way, if any. */
  private pageTurn: PageTurn | null = null
  finished = false
  private failed = new Set<string>()
  private session: OpenStory | null = null
  private backRows: BackIssueRow[] | null = null
  private bodyRequests = new Map<string, Promise<StoryBody | null>>()
  private scrollCleanup: (() => void) | null = null

  constructor(opts: ReaderOptions) {
    this.app = opts.app
    this.stage = opts.stage
    const kv = opts.kv ?? browserKV()
    this.store = new Store(kv, namespaceFor(opts.pathname ?? location.pathname))
    this.library = new Library(this.store)
    this.queue = new EventQueue(this.store, uuid)
    this.log = new ReadingLog(this.store)
    this.uploader = new Uploader({ queue: this.queue, deviceId: deviceId(kv, uuid), paper: () => this.library.paper() })
    this.look = readLook(this.store.get<unknown>('look', null))
    this.settings = this.library.settings() ?? { profile: '', profile_root: true, title: document.title || 'Early Edition', mode: 'pages', age: 8 }
  }

  today(): string {
    return londonDate(new Date())
  }

  // ---------- start ----------

  start(): void {
    this.recoverSession()
    this.applySettings()
    applyLook(this.look)
    const today = this.today()
    this.library.tidy(today)
    this.log.prune(today)
    this.log.dropBefore(this.library.readingSince())
    const current = this.library.currentDate()
    const kept = current ? this.library.cached(current) : null
    if (kept) {
      this.issue = kept.issue
      this.screen = 'front'
    }
    this.render()
    this.listen()
    void this.uploader.flush()
    void this.checkForNews(false)
  }

  private applySettings(): void {
    document.body.classList.remove('age-young', 'age-mid', 'age-older')
    document.body.classList.add(ageClass(this.settings.age))
  }

  // ---------- the server ----------

  /** Keep an issue response, following the Kindle's rules for profiles, resets and versions. */
  private accept(issue: Issue): void {
    if (this.library.checkPaper(issue)) {
      // A different child's paper is served here now: everything of the old one is gone.
      this.session = null
      this.failed.clear()
      this.bodyRequests.clear()
    }
    if (isIsoDate(issue.reading_since)) {
      this.library.setReadingSince(issue.reading_since)
      this.log.dropBefore(issue.reading_since)
    }
    const outcome = this.library.putIssue(issue, nowSeconds())
    if (outcome !== 'kept' && this.library.firstSeen(issue.date, issue.version)) {
      this.queue.add('issue_downloaded', null, { date: issue.date, version: issue.version }, nowSeconds())
    }
  }

  /** Ask for today's paper now. `asked`: the reader pressed Check for news. */
  async checkForNews(asked: boolean): Promise<void> {
    if (this.checking) return
    this.checking = true
    this.refreshStatus()
    const before = this.issue ? `${this.issue.date}/${this.issue.version}/${this.issue.stories.map((s) => s.id).join(',')}` : ''
    try {
      try {
        const s = await getSettings()
        if (s && (s.mode === 'pages' || s.mode === 'scroll') && typeof s.age === 'number') {
          this.settings = s
          this.library.setSettings(s)
          this.applySettings()
        }
      } catch {
        // The issue request below says what is wrong.
      }
      const fresh = await getIssue()
      this.accept(fresh)
      this.library.setCurrent(fresh.date)
      this.library.setLastCheck(nowSeconds())
      this.todayStatus = 'ok'
      const kept = this.library.cached(fresh.date)?.issue ?? fresh
      void this.prefetchBodies(kept)
      const after = `${kept.date}/${kept.version}/${kept.stories.map((s) => s.id).join(',')}`
      if (this.viewingToday) {
        if (this.screen === 'story') this.pendingToday = kept
        else {
          this.issue = kept
          // Redraw only when something changed, so the front page does not flash.
          if (this.screen === 'loading' || this.screen === 'waiting' || (this.screen === 'front' && after !== before)) {
            this.screen = 'front'
            this.render()
          }
        }
      }
      if (asked && after === before) this.note('You have the latest paper.')
      else if (asked && this.screen !== 'front') this.note('Today’s paper is on the front page.')
    } catch (err) {
      const kind = err instanceof ApiError ? err.kind : 'network'
      if (kind === 'not_found') {
        this.todayStatus = 'not_ready'
        this.library.setLastCheck(nowSeconds())
        if (this.viewingToday && ['loading', 'waiting', 'front'].includes(this.screen)) {
          this.screen = 'waiting'
          this.render()
        }
      } else {
        this.todayStatus = 'offline'
        if (this.viewingToday && (this.screen === 'loading' || this.screen === 'waiting')) {
          this.screen = this.issue ? 'front' : 'waiting'
          this.render()
        }
        if (asked) this.note('The news can’t be reached right now.')
      }
    } finally {
      this.checking = false
      this.refreshStatus()
      void this.uploader.flush()
    }
  }

  private bodyOf(issue: Issue, s: ApiStory): StoryBody | null {
    return this.library.cached(issue.date)?.bodies[s.id] ?? null
  }

  /** The story's text: kept, or fetched from its story page once. */
  private fetchBody(issue: Issue, s: ApiStory): Promise<StoryBody | null> {
    const have = this.bodyOf(issue, s)
    if (have) return Promise.resolve(have)
    const key = `${issue.date}/${s.id}`
    let req = this.bodyRequests.get(key)
    if (!req) {
      req = getStoryHtml(s.path)
        .then((html) => {
          const body = parseStoryHtml(html)
          this.library.putBody(issue.date, s.id, body)
          return body
        })
        .catch(() => {
          this.bodyRequests.delete(key)
          return null
        })
      this.bodyRequests.set(key, req)
    }
    return req
  }

  private async prefetchBodies(issue: Issue): Promise<void> {
    await Promise.all(issue.stories.map((s) => this.fetchBody(issue, s)))
  }

  // ---------- rendering ----------

  private ctx(issue: Issue = this.issue!): ViewCtx {
    return {
      issue,
      read: this.library.readIds(issue.date),
      photo: (s) => (s.image && !this.failed.has(s.image.path) ? joinMount(s.image.path) : null),
    }
  }

  private status(): DatelineStatus {
    if (!this.viewingToday) return 'back'
    if (this.checking) return 'checking'
    if (this.todayStatus === 'offline') return 'offline'
    return 'check'
  }

  private title(): string {
    return this.issue?.title || this.settings.title || 'Early Edition'
  }

  render(): void {
    this.scrollCleanup?.()
    this.scrollCleanup = null
    if (this.screen !== 'story') this.lookOpen = false
    this.app.dataset.mode = this.mode
    this.app.dataset.screen = this.screen
    const today = this.today()
    switch (this.screen) {
      case 'loading':
        this.stage.innerHTML = loadingHtml(this.title(), today)
        break
      case 'waiting':
        this.stage.innerHTML = waitingHtml(this.todayStatus === 'not_ready' ? 'not_ready' : 'offline', this.title(), today, this.checking)
        break
      case 'front':
        if (!this.issue || !this.issue.stories.length) {
          this.screen = 'waiting'
          this.render()
          return
        }
        this.stage.innerHTML = frontHtml(this.ctx(), this.status())
        if (this.library.firstListed(this.issue.date, this.issue.version)) {
          this.queue.add('list_shown', null, { date: this.issue.date, version: this.issue.version }, nowSeconds())
          this.uploader.schedule(UPLOAD_DELAY_MS)
        }
        break
      case 'story':
        if (this.mode === 'pages') this.renderPaged()
        else this.renderLong()
        break
      case 'backissues':
        this.stage.innerHTML = backIssuesHtml(this.backRows)
        break
      case 'myweek':
        this.stage.innerHTML = myWeekHtml(myWeek(this.log.entries(), today))
        break
    }
  }

  /** Update only the Check for news control, so the front page does not flash. */
  private refreshStatus(): void {
    if (this.screen === 'waiting') return this.render()
    if (this.screen !== 'front' || !this.issue) return
    const el = $('.dateline .dl-btn', this.stage)
    if (!el) return
    const fresh = document.createElement('div')
    fresh.innerHTML = frontHtml(this.ctx(), this.status())
    const btn = $('.dateline .dl-btn', fresh)
    if (btn) el.replaceWith(btn)
  }

  note(text: string): void {
    $('.note', this.stage)?.remove()
    const el = document.createElement('p')
    el.className = 'note'
    el.setAttribute('role', 'status')
    el.textContent = text
    this.stage.appendChild(el)
    setTimeout(() => el.remove(), 2600)
  }

  // ---------- moving about ----------

  /** Where "Front page" leads: the paper on show, or the waiting screen. */
  private toFront(): void {
    this.closeSession()
    if (this.viewingToday && this.pendingToday) {
      this.issue = this.pendingToday
      this.pendingToday = null
    }
    if (this.viewingToday && this.todayStatus === 'not_ready') this.screen = 'waiting'
    else if (this.issue) this.screen = 'front'
    else this.screen = this.todayStatus === 'unknown' ? 'loading' : 'waiting'
    this.story = 0
    this.page = 0
    this.finished = false
    this.render()
  }

  go(where: string): void {
    if (where === 'front') return this.toFront()
    const i = Number(where)
    if (!this.issue || !Number.isInteger(i) || !this.issue.stories[i]) return
    if (this.screen === 'story' && this.mode === 'scroll') {
      this.scrollToStory(i, true)
      return
    }
    this.closeSession()
    this.mode = this.settings.mode
    this.screen = 'story'
    this.story = i
    this.page = 0
    this.pages = 1
    this.finished = false
    if (this.mode === 'pages') this.openSession(this.issue, this.issue.stories[i])
    this.render()
  }

  async openBackIssues(): Promise<void> {
    this.closeSession()
    this.screen = 'backissues'
    const today = this.today()
    const dates = Array.from({ length: BACK_ISSUE_DAYS }, (_, k) => addDays(today, -(k + 1)))
    const row = (date: string, issue: Issue): BackIssueRow => {
      const lead = [...issue.stories].sort((a, b) => a.position - b.position)[0]
      return {
        date,
        issue,
        read: this.library.readIds(date),
        photo: lead?.image && !this.failed.has(lead.image.path) ? joinMount(lead.image.path) : null,
      }
    }
    // What is kept shows at once; the server's answers replace it.
    const kept = dates.map((d) => this.library.cached(d)).filter((c) => c && c.issue.stories.length)
    this.backRows = kept.length ? kept.map((c) => row(c!.issue.date, c!.issue)) : null
    this.render()
    const found = await Promise.all(
      dates.map(async (d) => {
        try {
          this.accept(await getIssue(d))
        } catch (err) {
          if (err instanceof ApiError && err.kind === 'not_found') return null
        }
        const c = this.library.cached(d)
        return c && c.issue.stories.length ? row(d, c.issue) : null
      }),
    )
    this.backRows = found.filter((r): r is BackIssueRow => r !== null)
    void this.uploader.flush()
    if (this.screen === 'backissues') this.render()
  }

  openIssue(date: string): void {
    const c = this.library.cached(date)
    if (!c) return
    this.closeSession()
    this.issue = c.issue
    this.viewingToday = date === this.today()
    this.screen = 'front'
    void this.prefetchBodies(c.issue)
    this.render()
  }

  backToToday(): void {
    this.viewingToday = true
    const current = this.library.currentDate()
    const c = current ? this.library.cached(current) : null
    this.issue = c?.issue ?? null
    this.toFront()
    if (this.todayStatus !== 'ok' || !c || current !== this.today()) void this.checkForNews(false)
  }

  async openYesterday(): Promise<void> {
    const date = addDays(this.today(), -1)
    if (!this.library.cached(date)) {
      try {
        this.accept(await getIssue(date))
      } catch {
        // not there: the list says what there is
      }
    }
    if (this.library.cached(date)?.issue.stories.length) this.openIssue(date)
    else void this.openBackIssues()
  }

  openMyWeek(): void {
    this.closeSession()
    this.screen = 'myweek'
    this.render()
  }

  // ---------- reading sessions (story_opened / story_closed) ----------

  private openSession(issue: Issue, s: ApiStory): void {
    if (this.session && this.session.storyId === s.id && this.session.date === issue.date) return
    this.closeSession()
    const word = s.word_to_know ?? this.bodyOf(issue, s)?.word ?? null
    this.session = {
      storyId: s.id,
      date: issue.date,
      topic: s.topic,
      title: s.title,
      word: word?.word ?? null,
      definition: word?.definition ?? null,
      total: null,
      tracker: new Tracker(),
    }
    this.queue.add('story_opened', s.id, {}, nowSeconds())
    this.library.markOpened(issue.date, s.id)
    this.persistSession()
  }

  private persistSession(): void {
    const s = this.session
    if (!s) return this.store.remove('session')
    const rec: SessionRecord = { ...s, tracker: s.tracker.state() }
    this.store.set('session', rec)
  }

  /** Close the open story: queue story_closed, write the reading log, and send it soon. */
  closeSession(): void {
    const s = this.session
    if (!s) return
    this.session = null
    this.store.remove('session')
    this.recordClose(s, s.tracker)
  }

  private recordClose(s: Omit<OpenStory, 'tracker'>, tracker: Tracker): void {
    const f = tracker.result(s.total ?? undefined)
    this.queue.add('story_closed', s.storyId, { ...f }, nowSeconds())
    if (f.finished) this.library.markRead(s.date, s.storyId)
    this.log.append({
      date: s.date,
      story_id: s.storyId,
      topic: s.topic,
      title: s.title,
      active_seconds: f.active_seconds,
      finished: f.finished,
      ts: nowSeconds(),
      day: this.today(),
      word: s.word,
      definition: s.definition,
    })
    this.uploader.schedule(UPLOAD_DELAY_MS)
  }

  /** A story left open when the app was closed or the iPad killed it: close it now with what was measured. */
  private recoverSession(): void {
    const rec = this.store.get<SessionRecord | null>('session', null)
    if (!rec || typeof rec.storyId !== 'number' || !rec.tracker) return
    this.store.remove('session')
    const tracker = new Tracker(undefined, undefined, rec.tracker)
    tracker.pause()
    this.recordClose(rec, tracker)
  }

  // ---------- a story, in pages ----------

  private renderPaged(): void {
    const issue = this.issue!
    const s = issue.stories[this.story]
    const body = this.bodyOf(issue, s)
    this.stage.innerHTML = pagedHtml(this.ctx(), this.story, body)
    this.layoutPages(false)
    if (this.finished) this.showFinished(false)
    this.showLook()
    if (!body) {
      void this.fetchBody(issue, s).then((b) => {
        if (this.screen === 'story' && this.mode === 'pages' && this.issue === issue && this.issue.stories[this.story] === s) {
          if (!b) this.note('This story can’t be fetched right now.')
          else this.render()
        }
      })
    }
  }

  /** The first block on the page showing, to keep the reader on the same words through a re-layout. */
  private pageAnchor(): Element | null {
    const pager = $('#pager', this.stage)
    const flow = $('#flow', this.stage)
    if (!pager || !flow) return null
    const box = pager.getBoundingClientRect()
    const blocks = Array.from(flow.children)
    // A paragraph carried over from the page before reports a box that starts there, so the first
    // block that starts on this page is the better mark; the carried-over one only when there is none.
    const showing = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.right > box.left + 1 && r.left < box.right - 1 && r.height > 0
    }
    return blocks.find((el) => showing(el) && el.getBoundingClientRect().left >= box.left - 1) ?? blocks.find(showing) ?? null
  }

  /**
   * Lay the story out as pages (a spread on its side). `keepPlace` keeps the reader on the same
   * words; pass the anchor when it had to be found before the layout changed (a new text size).
   */
  layoutPages(keepPlace: boolean, before: Element | null = null): void {
    const pager = $('#pager', this.stage)
    const flow = $('#flow', this.stage)
    if (!pager || !flow) return
    const anchor = before ?? (keepPlace ? this.pageAnchor() : null)
    const landscape = window.matchMedia('(orientation: landscape)').matches
    const cols = landscape ? 2 : 1
    const w = pager.clientWidth || 1
    const h = pager.clientHeight
    flow.style.setProperty('--cols', String(cols))
    flow.style.setProperty('--colw', `${w / cols}px`)
    // Upright: the photo takes the top of page one. On its side: it fills the left-hand page.
    flow.style.setProperty('--shot-h', `${Math.round(cols === 2 ? h - 66 : h * 0.4)}px`)
    flow.style.setProperty('--plain-h', '0px')
    // In a spread the opener is exactly one page tall (the flow's padding is 30 above and 22 below).
    flow.style.setProperty('--opener-h', `${h - 24}px`)
    this.pages = pageCount(flow, w)
    if (anchor) {
      const at = anchor.getBoundingClientRect().left - flow.getBoundingClientRect().left
      this.page = Math.floor((at + 2) / w)
    }
    this.page = Math.max(0, Math.min(this.page, this.pages - 1))
    flow.style.transform = `translateX(${-this.page * w}px)`
    const where = $('#where', this.stage)
    if (where) where.textContent = `Page ${this.page + 1} of ${this.pages}`
    const dots = $('#dots', this.stage)
    if (dots) dots.innerHTML = Array.from({ length: this.pages }, (_, k) => `<i class="${k === this.page ? 'on' : ''}"></i>`).join('')
    const prev = $<HTMLButtonElement>('.turn.prev', this.stage)
    if (prev) prev.disabled = this.page === 0
    const label = $('#nextLabel', this.stage)
    if (label) label.textContent = this.page === this.pages - 1 ? 'Finish' : 'Next page'
    this.trackPage()
  }

  private trackPage(): void {
    const s = this.session
    const issue = this.issue
    if (!s || !issue || this.screen !== 'story' || this.mode !== 'pages') return
    s.total = this.pages
    if (s.tracker.page(this.page + 1, this.pages)) this.library.markRead(s.date, s.storyId)
    this.persistSession()
  }

  turn(by: number): void {
    if (this.screen !== 'story' || this.mode !== 'pages') return
    if (this.finished) {
      if (by < 0) {
        this.finished = false
        $('.finished', this.stage)?.remove()
      }
      return
    }
    this.pageTurn?.finishNow()
    const to = this.page + by
    if (to < 0) return
    if (to >= this.pages) return this.finish()
    const leaf = this.startTurn(to)
    if (leaf) {
      leaf.release(true)
      return
    }
    this.page = to
    this.layoutPages(false)
  }

  /** A page turn from the current page to `to`, or null when there is nothing to animate. */
  private startTurn(to: number, corner: 'top' | 'bottom' = 'bottom'): PageTurn | null {
    const pager = $('#pager', this.stage)
    const flow = $('#flow', this.stage)
    if (!pager || !flow || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
    if (typeof requestAnimationFrame !== 'function' || !pager.clientWidth) return null
    const cols = window.matchMedia('(orientation: landscape)').matches ? 2 : 1
    const leaf = new PageTurn({ pager, flow, from: this.page, to, cols, corner })
    leaf.setProgress(0)
    this.pageTurn = leaf
    void leaf.done.then((turned) => {
      if (this.pageTurn === leaf) this.pageTurn = null
      if (!turned || this.screen !== 'story' || this.mode !== 'pages') return
      this.page = to
      this.layoutPages(false)
    })
    return leaf
  }

  private finish(): void {
    const issue = this.issue!
    const s = issue.stories[this.story]
    this.session?.tracker.markEnd(this.pages)
    this.persistSession()
    this.library.markRead(issue.date, s.id)
    this.finished = true
    this.updateHead()
    this.showFinished(true)
  }

  private showFinished(animate: boolean): void {
    $('.finished', this.stage)?.remove()
    const holder = document.createElement('div')
    holder.innerHTML = finishedHtml(this.ctx(), this.story, animate)
    const el = holder.firstElementChild
    if (el) this.stage.appendChild(el)
  }

  private updateHead(): void {
    const el = $('#place', this.stage)
    if (el && this.issue) el.innerHTML = place(this.ctx(), this.story)
  }

  // ---------- a story, scrolling: one long paper ----------

  private renderLong(restore?: { story: number; offset: number }): void {
    const issue = this.issue!
    const bodies = issue.stories.map((s) => this.bodyOf(issue, s))
    this.stage.innerHTML = longHtml(this.ctx(), this.story, bodies, this.viewingToday)
    const long = $('#long', this.stage)!
    long.style.setProperty('--stage-h', `${long.clientHeight}px`)
    const topOf = (i: number) => ($(`#story-${i}`, this.stage) as HTMLElement | null)?.offsetTop ?? 0
    const base = long.offsetTop
    const start = restore ?? { story: this.story, offset: 0 }
    long.scrollTop = topOf(start.story) - base + start.offset
    this.showLook()

    const missing = issue.stories.filter((_, i) => !bodies[i])
    if (missing.length) {
      void Promise.all(missing.map((s) => this.fetchBody(issue, s))).then((got) => {
        if (this.screen !== 'story' || this.mode !== 'scroll' || this.issue !== issue || !got.some(Boolean)) return
        this.renderLong(this.scrollPlace())
      })
    }

    // A story is read when its end comes into view; the stamp lands then.
    const Observer = window.IntersectionObserver
    const seen = Observer
      ? new Observer(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue
              this.endSeen(Number((e.target as HTMLElement).dataset.fin), e.target as HTMLElement)
            }
          },
          { root: long, threshold: 0.9 },
        )
      : null
    long.querySelectorAll('.fin-inline').forEach((el) => seen?.observe(el))

    // The running head follows the story on screen; a story counts as opened after a moment there.
    let queued = false
    let openTimer: ReturnType<typeof setTimeout> | null = null
    const current = () => {
      const line = long.scrollTop + long.clientHeight * 0.4
      let now = 0
      issue.stories.forEach((_, i) => {
        if (topOf(i) - base <= line) now = i
      })
      return now
    }
    const settle = () => {
      if (openTimer) clearTimeout(openTimer)
      const i = this.story
      openTimer = setTimeout(() => {
        if (this.screen === 'story' && this.mode === 'scroll' && this.story === i && this.issue === issue) {
          this.openSession(issue, issue.stories[i])
          this.trackScroll(long, topOf, base)
        }
      }, SCROLL_OPEN_MS)
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        const now = current()
        if (now !== this.story) {
          this.story = now
          this.updateHead()
          if (this.session && this.session.storyId !== issue.stories[now].id) this.closeSession()
          settle()
        } else {
          this.trackScroll(long, topOf, base)
        }
      })
    }
    long.addEventListener('scroll', onScroll, { passive: true })
    this.story = current()
    this.updateHead()
    settle()
    this.scrollCleanup = () => {
      seen?.disconnect()
      if (openTimer) clearTimeout(openTimer)
      long.removeEventListener('scroll', onScroll)
    }
  }

  /** In the long paper a story's "pages" are screens of it: how far down it the reader has got. */
  private trackScroll(long: HTMLElement, topOf: (i: number) => number, base: number): void {
    const s = this.session
    const issue = this.issue
    if (!s || !issue) return
    const i = issue.stories.findIndex((x) => x.id === s.storyId)
    const el = $(`#story-${i}`, this.stage) as HTMLElement | null
    if (i < 0 || !el) return
    const screen = Math.max(1, long.clientHeight)
    const total = Math.max(2, Math.ceil(el.offsetHeight / screen))
    s.total = total
    const reached = Math.ceil((long.scrollTop + screen - (topOf(i) - base)) / screen)
    s.tracker.page(Math.max(1, Math.min(total - 1, reached)), total)
    this.persistSession()
  }

  private endSeen(i: number, el: HTMLElement): void {
    const issue = this.issue
    if (!issue || !issue.stories[i]) return
    const s = issue.stories[i]
    if (this.session && this.session.storyId === s.id) {
      this.session.tracker.markEnd(this.session.total ?? 2)
      this.persistSession()
    } else if (!this.library.readIds(issue.date).has(s.id)) {
      // Read to the end without stopping on it long enough to count as opened: record it all the same.
      const t = new Tracker()
      t.markEnd(2)
      const word = s.word_to_know ?? this.bodyOf(issue, s)?.word ?? null
      this.queue.add('story_opened', s.id, {}, nowSeconds())
      this.library.markOpened(issue.date, s.id)
      this.recordClose(
        { storyId: s.id, date: issue.date, topic: s.topic, title: s.title, word: word?.word ?? null, definition: word?.definition ?? null, total: 2 },
        t,
      )
    }
    if (this.library.markRead(issue.date, s.id) || el.classList.contains('waiting')) {
      el.classList.remove('waiting')
      $('.stamp', el)?.classList.add('land')
      const t = tally(this.ctx())
      this.stage.querySelectorAll('.tally-slot').forEach((slot) => (slot.innerHTML = t))
    }
  }

  private scrollPlace(): { story: number; offset: number } {
    const long = $('#long', this.stage)
    const el = $(`#story-${this.story}`, this.stage) as HTMLElement | null
    if (!long || !el) return { story: this.story, offset: 0 }
    return { story: this.story, offset: Math.max(0, long.scrollTop - (el.offsetTop - long.offsetTop)) }
  }

  private scrollToStory(i: number, smooth: boolean): void {
    const long = $('#long', this.stage)
    const el = $(`#story-${i}`, this.stage) as HTMLElement | null
    if (!long || !el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    long.scrollTo({ top: el.offsetTop - long.offsetTop, behavior: smooth && !reduce ? 'smooth' : 'auto' })
  }

  // ---------- events from the page ----------

  private onClick(e: MouseEvent): void {
    const target = e.target as Element
    if (this.lookOpen) {
      const choice = target.closest<HTMLButtonElement>('[data-look]')
      if (choice) {
        if (choice.dataset.look === 'done') this.closeLook()
        else if (!choice.disabled) this.changeLook(choice.dataset.look ?? '')
        return
      }
      // A tap anywhere else puts the panel away and does nothing more (no page turn), except the Aa button's own.
      if (!target.closest('#look') && !target.closest('.look-btn')) {
        this.closeLook()
        return
      }
      if (target.closest('#look')) return
    }
    const t = target.closest<HTMLElement>('[data-go],[data-turn],[data-act],[data-issue]')
    if (t) {
      if ((t as HTMLButtonElement).disabled) return
      if (t.dataset.go !== undefined) this.go(t.dataset.go)
      else if (t.dataset.turn) this.turn(Number(t.dataset.turn))
      else if (t.dataset.issue) this.openIssue(t.dataset.issue)
      else this.act(t.dataset.act ?? '')
      return
    }
    // Tapping the outer thirds of a page turns it.
    const pager = (e.target as Element).closest<HTMLElement>('#pager')
    if (pager && !this.finished) {
      const x = (e.clientX - pager.getBoundingClientRect().left) / pager.clientWidth
      if (x > 0.67) this.turn(1)
      else if (x < 0.33) this.turn(-1)
    }
  }

  private act(what: string): void {
    switch (what) {
      case 'check':
        void this.checkForNews(true)
        break
      case 'today':
        this.backToToday()
        break
      case 'yesterday':
        void this.openYesterday()
        break
      case 'backissues':
        void this.openBackIssues()
        break
      case 'myweek':
        this.openMyWeek()
        break
      case 'look':
        if (this.lookOpen) this.closeLook()
        else this.openLook()
        break
    }
  }

  // ---------- text size and page colour ----------

  openLook(): void {
    if (this.screen !== 'story') return
    this.lookOpen = true
    this.showLook(true)
  }

  closeLook(): void {
    this.lookOpen = false
    this.showLook()
  }

  /** Draw the Aa panel as it now is (or take it away), and mark the button. `animate`: it is just opening. */
  private showLook(animate = false): void {
    const old = $('#look', this.stage)
    $('.look-btn', this.stage)?.setAttribute('aria-expanded', String(this.lookOpen))
    if (!this.lookOpen) return void old?.remove()
    const holder = document.createElement('div')
    holder.innerHTML = lookHtml(this.look)
    const el = holder.firstElementChild!
    if (animate) el.classList.add('enter')
    if (old) old.replaceWith(el)
    else this.stage.appendChild(el)
  }

  /** "smaller", "bigger" or "theme:<name>" from the panel. */
  changeLook(what: string): void {
    const next: Look = { ...this.look }
    if (what === 'smaller') next.size = Math.max(0, next.size - 1)
    else if (what === 'bigger') next.size = Math.min(SIZES.length - 1, next.size + 1)
    else if (what.startsWith('theme:')) next.theme = readLook({ theme: what.slice(6) as Theme }).theme
    if (next.size === this.look.size && next.theme === this.look.theme) return
    const resize = next.size !== this.look.size
    // Where the reader is, found before the text moves.
    const paged = resize && this.screen === 'story' && this.mode === 'pages'
    const scrolled = resize && this.screen === 'story' && this.mode === 'scroll'
    if (paged) {
      this.pageTurn?.finishNow()
      $('#flow', this.stage)?.classList.remove('turning')
    }
    const anchor = paged ? this.pageAnchor() : null
    const placeNow = scrolled ? this.scrollPlace() : null
    const oldHeight = placeNow ? ($(`#story-${placeNow.story}`, this.stage)?.offsetHeight ?? 0) : 0
    this.look = next
    this.store.set('look', next)
    applyLook(next)
    if (paged) this.layoutPages(true, anchor)
    if (placeNow) {
      const long = $('#long', this.stage)
      const el = $(`#story-${placeNow.story}`, this.stage)
      if (long && el) {
        const k = oldHeight ? el.offsetHeight / oldHeight : 1
        long.scrollTop = el.offsetTop - long.offsetTop + placeNow.offset * k
      }
    }
    this.showLook()
  }

  /** Hidden (another app, the iPad asleep): stop the reading clock and send what is queued. */
  private onHide(): void {
    this.session?.tracker.pause()
    this.persistSession()
    void this.uploader.flush(true)
  }

  private onShow(): void {
    this.session?.tracker.resume()
    const stale = nowSeconds() - this.library.lastCheck() >= RECHECK_SECONDS
    const newDay = this.viewingToday && this.issue !== null && this.issue.date !== this.today()
    if (stale || newDay || this.todayStatus === 'offline') void this.checkForNews(false)
    else void this.uploader.flush()
  }

  private onPhotoError(e: Event): void {
    const img = e.target
    if (!(img instanceof HTMLImageElement) || !img.dataset.photo) return
    if (this.failed.has(img.dataset.photo)) return
    // A photo that fails to load is treated as a story with no photo.
    this.failed.add(img.dataset.photo)
    if (this.screen === 'story' && this.mode === 'scroll') this.renderLong(this.scrollPlace())
    else if (this.screen === 'backissues' && this.backRows) {
      this.backRows = this.backRows.map((r) => (r.photo === img.getAttribute('src') ? { ...r, photo: null } : r))
      this.render()
    } else this.render()
  }

  private listen(): void {
    this.app.addEventListener('click', (e) => this.onClick(e))
    this.app.addEventListener('error', (e) => this.onPhotoError(e), true)

    // Swipe sideways to turn. Dragging holds the page and turns it with the finger, as in a book.
    let downX: number | null = null
    let downY = 0
    let downAt = 0
    let drag: { leaf: PageTurn; to: number; span: number } | null = null
    const swallowClick = () => this.stage.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true })
    this.stage.addEventListener('pointerdown', (e) => {
      downX = e.clientX
      downY = e.clientY
      downAt = e.timeStamp
      drag = null
    })
    this.stage.addEventListener('pointermove', (e) => {
      if (downX === null || this.screen !== 'story' || this.mode !== 'pages' || this.finished || this.lookOpen) return
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      if (!drag) {
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy)) return
        const to = this.page + (dx < 0 ? 1 : -1)
        if (to < 0 || to >= this.pages) return
        this.pageTurn?.finishNow()
        const pagerBox = $('#pager', this.stage)?.getBoundingClientRect()
        const corner = pagerBox && downY < pagerBox.top + pagerBox.height / 3 ? 'top' : 'bottom'
        const leaf = this.startTurn(to, corner)
        const pager = $('#pager', this.stage)
        if (!leaf || !pager) return
        const cols = window.matchMedia('(orientation: landscape)').matches ? 2 : 1
        drag = { leaf, to, span: (pager.clientWidth / cols) * 0.9 }
      }
      drag.leaf.setProgress(Math.abs(dx) / drag.span)
    })
    this.stage.addEventListener('pointerup', (e) => {
      if (downX === null) return
      const dx = e.clientX - downX
      const dy = e.clientY - downY
      downX = null
      if (drag) {
        const fast = Math.abs(dx) / Math.max(1, e.timeStamp - downAt) > 0.5
        drag.leaf.release(Math.abs(dx) / drag.span > 0.3 || fast)
        drag = null
        swallowClick()
        return
      }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && this.screen === 'story' && this.mode === 'pages' && !this.lookOpen) {
        this.turn(dx < 0 ? 1 : -1)
        e.preventDefault()
        // The swipe ends in a click; it should not also turn by tapping.
        swallowClick()
      }
    })
    this.stage.addEventListener('pointercancel', () => {
      downX = null
      drag?.leaf.release(false)
      drag = null
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.lookOpen) this.closeLook()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') this.turn(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.turn(-1)
    })

    // Turning the iPad re-lays the pages without losing the reader's place.
    let resizing: ReturnType<typeof setTimeout> | undefined
    window.addEventListener('resize', () => {
      clearTimeout(resizing)
      const placeNow = this.screen === 'story' && this.mode === 'scroll' ? this.scrollPlace() : null
      resizing = setTimeout(() => {
        if (this.screen === 'story' && this.mode === 'pages') {
          this.pageTurn?.finishNow()
          $('#flow', this.stage)?.classList.remove('turning')
          this.layoutPages(true)
        } else if (this.screen === 'story' && this.mode === 'scroll') {
          this.renderLong(placeNow ?? this.scrollPlace())
        } else if (this.screen === 'front' || this.screen === 'backissues' || this.screen === 'myweek') {
          // CSS does the work; nothing to measure.
        }
      }, 80)
    })

    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? this.onHide() : this.onShow()))
    window.addEventListener('pagehide', () => this.onHide())
    window.addEventListener('online', () => this.onShow())
    // Left open on the front page: look again every half hour, like the Kindle.
    setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (this.screen !== 'front' && this.screen !== 'waiting') return
      if (nowSeconds() - this.library.lastCheck() >= RECHECK_SECONDS || (this.issue && this.viewingToday && this.issue.date !== this.today())) {
        void this.checkForNews(false)
      }
    }, 60_000)

    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (this.screen === 'story' && this.mode === 'pages') this.layoutPages(true)
      })
    }
  }
}
