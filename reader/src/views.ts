// The reader's screens as HTML, ported from the approved mock-up (docs/mockups/ipad-reader/).
// Every value from the server goes through esc(); story paragraphs are already reduced to text
// and bold by body.ts. There are no links: everything is a button handled by app.ts.

import { esc } from './body'
import { dayAndDate, longDate, stampDate } from './clock'
import { icon, stamp, topicKey } from './icons'
import { SIZES, THEMES, type Look } from './look'
import type { WeekModel } from './readlog'
import type { ApiStory, Issue, StoryBody } from './types'

export interface ViewCtx {
  issue: Issue
  read: Set<number>
  /** The photo's URL, or null when the story has none (or it failed to load). */
  photo(s: ApiStory): string | null
}

export type DatelineStatus = 'check' | 'checking' | 'offline' | 'back'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export const readCount = (c: ViewCtx) => c.issue.stories.filter((s) => c.read.has(s.id)).length

/** The next story not yet read after `from` (wrapping round), or null when the paper is finished. */
export function nextUnread(stories: ApiStory[], read: Set<number>, from: number): ApiStory | null {
  for (let k = 1; k <= stories.length; k++) {
    const s = stories[(from + k) % stories.length]
    if (!read.has(s.id)) return s
  }
  return null
}

export function tally(c: ViewCtx): string {
  const n = readCount(c)
  const all = c.issue.stories.length
  return `<p class="tally"><span class="pips" aria-hidden="true">${c.issue.stories
    .map((_, k) => `<i class="${k < n ? 'on' : ''}"></i>`)
    .join('')}</span>${n} of ${all} read</p>`
}

function img(c: ViewCtx, s: ApiStory, cls = ''): string {
  const src = c.photo(s)
  if (!src) return ''
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(s.image?.alt || '')}" data-photo="${esc(s.image?.path)}" draggable="false" decoding="async">`
}

const flag = (s: ApiStory) => `<span class="flag">${icon(topicKey(s.topic))}${esc(s.topic)} · ${plural(s.minutes, 'minute')} read</span>`

function datelineMiddle(status: DatelineStatus): string {
  switch (status) {
    case 'checking':
      return `<button class="dl-btn" disabled>${icon('refresh', 'spin')}Checking…</button>`
    case 'offline':
      return `<button class="dl-btn" data-act="check">${icon('refresh')}Can’t reach the news · Try again</button>`
    case 'back':
      return `<button class="dl-btn" data-act="today">${icon('back')}Back to today</button>`
    default:
      return `<button class="dl-btn" data-act="check">${icon('refresh')}Check for news</button>`
  }
}

/** The dateline, masthead and its rules: the top of every front page. */
export function masthead(title: string, date: string, number: number | null, middle: string): string {
  return `<div class="dateline"><span>${esc(longDate(date))}</span>${middle}<span>${number ? `No. ${number}` : ''}</span></div>
    <header class="mast">
      ${icon('sun', 'sun')}
      <h1>${esc(title)}</h1>
      <p class="tag">The news, written for you</p>
    </header>`
}

// ---------- front page ----------

export function frontHtml(c: ViewCtx, status: DatelineStatus): string {
  const stories = c.issue.stories
  const done = readCount(c) === stories.length
  const lead = stories.find((s) => !c.read.has(s.id)) ?? stories[0]
  const li = stories.indexOf(lead)
  const minutes = stories.reduce((n, s) => n + s.minutes, 0)
  const rest = stories.filter((s) => s !== lead)
  return `
    <section class="front">
      ${masthead(c.issue.title, c.issue.date, c.issue.number, datelineMiddle(status))}
      <div class="front-main">
        <article class="lead" data-topic="${topicKey(lead.topic)}">
          <figure class="lead-photo" data-go="${li}">
            ${c.photo(lead) ? img(c, lead) : icon(topicKey(lead.topic))}
            ${flag(lead)}
          </figure>
          <h2 data-go="${li}">${esc(lead.title)}</h2>
          <p class="teaser">${esc(lead.teaser)}</p>
          <div class="actions">
            <button class="btn go" data-go="${li}">${done ? 'Read it again' : 'Start reading'} ${icon('arrow')}</button>
            <div class="facts">${tally(c)}<p class="meta">${
              done ? 'You have read all of this paper' : `${plural(stories.length, 'story', 'stories')} · about ${plural(minutes, 'minute')}`
            }</p></div>
          </div>
        </article>
        <ol class="inside">
          ${rest
            .map((s) => {
              const read = c.read.has(s.id)
              return `<li><button class="row${read ? ' read' : ''}" data-go="${stories.indexOf(s)}" data-topic="${topicKey(s.topic)}">
                <span class="thumb">${c.photo(s) ? img(c, s) : icon(topicKey(s.topic))}${read ? icon('tick', 'tick') : ''}</span>
                <span><strong>${esc(s.title)}</strong><span class="meta">${esc(s.topic)} · ${read ? 'Read' : `${s.minutes} min`}</span></span>
              </button></li>`
            })
            .join('')}
          <li class="furniture"><button class="btn" data-act="backissues">Back issues</button><button class="btn" data-act="myweek">My week</button></li>
        </ol>
      </div>
    </section>`
}

// ---------- a story ----------

/** The running head: the way back to the front page, the paper's name, and which story this is. */
export function place(c: ViewCtx, index: number): string {
  return `Story ${index + 1} of ${c.issue.stories.length}<span class="pips" aria-hidden="true">${c.issue.stories
    .map((_, k) => `<i class="${k === index ? 'now' : ''}"></i>`)
    .join('')}</span>`
}

export const runhead = (c: ViewCtx, index: number) =>
  `<header class="runhead"><button class="home" data-go="front">${icon('back')}Front page</button><p class="word">${esc(c.issue.title)}</p><div class="head-end"><p class="place" id="place">${place(c, index)}</p>${lookButton}</div></header>`

/** The Aa button on a story: text size and page colour. */
const lookButton = '<button class="look-btn" data-act="look" aria-label="Text size and page colour" aria-haspopup="dialog" aria-expanded="false"><span aria-hidden="true">A<small>a</small></span></button>'

/** The panel the Aa button opens: bigger or smaller text, and paper, sepia or night. */
export function lookHtml(look: Look): string {
  const smallest = look.size === 0
  const biggest = look.size === SIZES.length - 1
  return `<section class="look" id="look" role="dialog" aria-labelledby="look-title">
    <header class="look-head"><h2 id="look-title">Text and colour</h2><button class="look-done" data-look="done">Done</button></header>
    <div class="look-part">
      <h3 class="kicker">Text size</h3>
      <div class="sizes">
        <button class="size-btn smaller" data-look="smaller" aria-label="Smaller text"${smallest ? ' disabled' : ''}>A</button>
        <span class="steps" role="img" aria-label="Size ${look.size + 1} of ${SIZES.length}">${SIZES.map((_, k) => `<i class="${k < look.size ? 'on' : k === look.size ? 'on now' : ''}"></i>`).join('')}</span>
        <button class="size-btn bigger" data-look="bigger" aria-label="Bigger text"${biggest ? ' disabled' : ''}>A</button>
      </div>
    </div>
    <div class="look-part">
      <h3 class="kicker">Page colour</h3>
      <div class="themes">${THEMES.map(
        (t) =>
          `<button class="swatch ${t.key}" data-look="theme:${t.key}" aria-pressed="${t.key === look.theme}"><span class="page" aria-hidden="true"><b>Aa</b><i></i><i></i><i></i>${icon('tick', 'picked')}</span><span class="name">${t.name}</span></button>`,
      ).join('')}</div>
    </div>
  </section>`
}

export function opener(c: ViewCtx, s: ApiStory, body: StoryBody | null): string {
  const key = topicKey(s.topic)
  if (!c.photo(s)) {
    return `<div class="opener plain">${icon(key)}<h1 class="headline">${esc(s.title)}</h1><p class="label">${esc(s.topic)} · ${plural(s.minutes, 'minute')} read</p></div>`
  }
  return `<figure class="opener">
    <div class="shot">${img(c, s)}${flag(s)}</div>
    ${body?.source ? `<figcaption><span class="credit">Photo: ${esc(body.source)}</span></figcaption>` : ''}
  </figure>`
}

export function bodyHtml(s: ApiStory, body: StoryBody | null): string {
  if (!body) return '<p class="para loading">Getting the story…</p>'
  const word = s.word_to_know ?? body.word
  return (
    body.paras.map((p) => `<p class="para">${p}</p>`).join('') +
    (word ? `<aside class="box word"><h2>Word to know</h2><p><b>${esc(capFirst(word.word))}</b>: ${esc(word.definition)}</p></aside>` : '') +
    (body.think ? `<aside class="box think"><h2>Think about it</h2><p>${esc(body.think)}</p></aside>` : '') +
    (body.source ? `<p class="source">Source: ${esc(body.source)}</p>` : '')
  )
}

export function pagedHtml(c: ViewCtx, index: number, body: StoryBody | null): string {
  const s = c.issue.stories[index]
  const photo = Boolean(c.photo(s))
  return `
    <article class="story paged" data-topic="${topicKey(s.topic)}">
      ${runhead(c, index)}
      <div class="pager" id="pager"><div class="flow" id="flow">
        ${opener(c, s, body)}${photo ? `<h1 class="headline">${esc(s.title)}</h1>` : ''}${bodyHtml(s, body)}
      </div></div>
      <footer class="turner">
        <button class="turn prev" data-turn="-1" aria-label="Page back">${icon('back')}</button>
        <p class="where" aria-live="polite"><span id="where"></span><span class="dots" id="dots" aria-hidden="true"></span></p>
        <button class="turn next" data-turn="1"><span id="nextLabel">Next page</span>${icon('arrow')}</button>
      </footer>
    </article>`
}

/** The panel that rises at the end of a story: the stamp, and the next unread story or the end of the paper. */
export function finishedHtml(c: ViewCtx, index: number, animate: boolean): string {
  const next = nextUnread(c.issue.stories, c.read, index)
  const ni = next ? c.issue.stories.indexOf(next) : -1
  return `<section class="finished${next ? '' : ' paper-done'}${animate ? ' enter' : ''}" role="dialog" aria-label="${next ? 'Story finished' : 'Paper finished'}">
    <div class="fin-head">
      <div class="stamp${animate ? ' land' : ''}">${stamp(stampDate(c.issue.date))}</div>
      <div><h2>${next ? 'Story finished!' : 'Paper finished!'}</h2>${tally(c)}</div>
    </div>
    ${
      next
        ? `<button class="next-story" data-go="${ni}" data-topic="${topicKey(next.topic)}">
            <span class="disc">${icon(topicKey(next.topic))}</span>
            <span><strong>${esc(next.title)}</strong><span class="meta">Next story · ${esc(next.topic)} · ${next.minutes} min</span></span>
            ${icon('arrow')}
          </button>`
        : `<div class="actions"><button class="btn go" data-go="front">Front page ${icon('arrow')}</button><button class="btn" data-act="myweek">My week</button></div>`
    }</section>`
}

/** Every story of the paper down one long page. */
export function longHtml(c: ViewCtx, index: number, bodies: (StoryBody | null)[], isToday: boolean): string {
  const stories = c.issue.stories
  return `<div class="scroller">${runhead(c, index)}<div class="long" id="long">
    ${stories
      .map((s, i) => {
        const next = stories[i + 1]
        const read = c.read.has(s.id)
        const photo = Boolean(c.photo(s))
        return `<article class="story" id="story-${i}" data-topic="${topicKey(s.topic)}">
          <div class="side">${opener(c, s, bodies[i])}</div>
          <div class="reel${photo ? '' : ' after-plain'}">
            ${photo ? `<h1 class="headline">${esc(s.title)}</h1>` : ''}${bodyHtml(s, bodies[i])}
            <div class="fin-inline${read ? '' : ' waiting'}" data-fin="${i}">
              <div class="stamp">${stamp(stampDate(c.issue.date))}</div>
              <div><h2>Story finished!</h2><span class="tally-slot">${tally(c)}</span>
              <p class="onward">${next ? `Next: ${esc(next.title)}` : 'That was the last story.'}</p></div>
            </div>
          </div>
        </article>`
      })
      .join('')}
    <section class="closer">
      <h2>${isToday ? 'That’s today’s paper' : 'That’s the whole paper'}</h2>
      <span class="tally-slot">${tally(c)}</span>
      <div class="actions">
        <button class="btn go" data-go="front">Front page ${icon('arrow')}</button>
        <button class="btn" data-act="backissues">Back issues</button>
        <button class="btn" data-act="myweek">My week</button>
      </div>
    </section>
  </div></div>`
}

// ---------- other screens ----------

/** The head of Back issues and My week: back to the front page, the screen's name, and a note. */
export const screenHead = (title: string, note: string) =>
  `<header class="runhead"><button class="home" data-go="front">${icon('back')}Front page</button><p class="word">${esc(title)}</p><p class="place">${esc(note)}</p></header>`

export interface BackIssueRow {
  date: string
  issue: Issue
  read: Set<number>
  photo: string | null
}

export function backIssuesHtml(rows: BackIssueRow[] | null): string {
  let list: string
  if (rows === null) {
    list = '<p class="quiet">Fetching the last week’s papers…</p>'
  } else if (!rows.length) {
    list = '<p class="quiet">There are no back issues yet. They’ll be here after a few days of papers.</p>'
  } else {
    list = `<ol class="issues">${rows
      .map((r) => {
        const lead = [...r.issue.stories].sort((a, b) => a.position - b.position)[0]
        const n = r.issue.stories.filter((s) => r.read.has(s.id)).length
        const all = r.issue.stories.length
        const key = lead ? topicKey(lead.topic) : 'generic'
        return `<li><button class="issue-row${n === all && all ? ' done' : ''}" data-issue="${esc(r.date)}" data-topic="${key}">
          <span class="thumb">${r.photo ? `<img src="${esc(r.photo)}" alt="" data-photo="${esc(lead?.image?.path)}" draggable="false" decoding="async">` : icon(key)}</span>
          <span class="issue-text">
            <span class="issue-day">${esc(dayAndDate(r.date))} · No. ${r.issue.number}</span>
            <strong>${esc(lead?.title ?? 'A paper with no stories')}</strong>
            <span class="tally"><span class="pips" aria-hidden="true">${r.issue.stories.map((_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</span>${
              n === all && all ? 'All read' : `${n} of ${all} read`
            }</span>
          </span>
          ${icon('arrow', 'go-arrow')}
        </button></li>`
      })
      .join('')}</ol>`
  }
  return `<section class="screen">${screenHead('Back issues', 'The last seven papers')}<div class="screen-body">${list}</div></section>`
}

export function myWeekHtml(m: WeekModel): string {
  const max = Math.max(1, ...m.topics.map((t) => t.n))
  const circles = m.days
    .map(
      (d) => `<li class="day ${d.when}${d.count ? ' some' : ''}"><span class="dname" aria-hidden="true">${d.letter}</span><span class="circle" aria-label="${esc(
        `${d.name}: ${d.when === 'future' ? 'still to come' : plural(d.count, 'story', 'stories') + ' read'}`,
      )}">${d.when === 'future' ? '' : d.count}</span></li>`,
    )
    .join('')
  const topics = m.topics.length
    ? `<section class="week-block"><h2 class="kicker">What you read about</h2><ul class="bars">${m.topics
        .slice(0, 6)
        .map(
          (t) =>
            `<li data-topic="${topicKey(t.name)}"><span class="bar-name">${esc(t.name)}</span><span class="bar"><i style="width:${Math.round(
              (t.n / max) * 100,
            )}%"></i></span><span class="bar-n">${t.n}</span></li>`,
        )
        .join('')}</ul></section>`
    : ''
  const words = m.words.length
    ? `<section class="week-block"><h2 class="kicker">Words to know</h2><ul class="words">${m.words
        .map((w) => `<li><b>${esc(capFirst(w.word))}</b>${w.definition ? `: ${esc(w.definition)}` : ''}</li>`)
        .join('')}</ul></section>`
    : ''
  const empty = m.total === 0 ? '<p class="quiet">Nothing read yet this week. Today’s paper is waiting on the front page.</p>' : ''
  return `<section class="screen week">${screenHead('My week', m.range)}<div class="screen-body">
    <ol class="days">${circles}</ol>
    <div class="stats">
      <div class="stat"><p class="kicker">Stories this week</p><p class="num">${m.total}</p></div>
      <div class="stat"><p class="kicker">Days in a row</p><p class="num">${m.streak}${icon('sun', 'sun')}</p></div>
    </div>
    ${empty}${topics}${words}
  </div></section>`
}

/** Today's paper isn't there yet, or the server can't be reached and there is no paper kept. */
export function waitingHtml(kind: 'not_ready' | 'offline', title: string, today: string, checking: boolean): string {
  const check = checking
    ? `<button class="btn" disabled>${icon('refresh', 'spin')}Checking…</button>`
    : `<button class="btn" data-act="check">${icon('refresh')}Check for news</button>`
  const text =
    kind === 'not_ready'
      ? `<h2>Today’s paper isn’t ready yet</h2><p class="teaser">It’s being written now. Yesterday’s paper is in Back issues while you wait.</p>
         <div class="actions"><button class="btn go" data-act="yesterday">Yesterday’s paper ${icon('arrow')}</button>${check}</div>`
      : `<h2>Can’t reach the news right now</h2><p class="teaser">The paper comes over the home Wi-Fi. When the iPad is back on it, check again.</p>
         <div class="actions">${check}</div>`
  return `<section class="front waiting">
    ${masthead(title, today, null, '<span></span>')}
    <div class="wait-body">${text}
      <div class="actions small"><button class="btn" data-act="backissues">Back issues</button><button class="btn" data-act="myweek">My week</button></div>
    </div>
  </section>`
}

export const loadingHtml = (title: string, today: string) =>
  `<section class="front waiting">${masthead(title, today, null, '<span></span>')}<div class="wait-body"><p class="quiet">Getting today’s paper…</p></div></section>`
