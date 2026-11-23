// The Sport page's screens as HTML (docs/sports-page.md section 2, mock-ups in
// docs/mockups/sports-page/). Every value from the server goes through esc(); every other word is
// one of ours. Like the rest of the reader there are no links, only buttons app.ts handles.

import { esc } from './body'
import { icon } from './icons'
import type { LockState } from './sport'
import type { Goal, Match, MatchDetail, Matchday, Player, Side, SportsView, TableRow } from './types'

export type SportTab = 'matches' | 'table' | 'next'

const TZ = 'Europe/London'
const noon = (date: string) => new Date(`${date}T12:00:00Z`)
const weekday = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long' }).format(noon(date))
const dayMonth = (date: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'long' }).format(noon(date))
/** "8:00pm", London time. */
export const kickoffTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(/\s/g, '').toLowerCase()
const londonDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'

function clubs(view: SportsView) {
  const by = new Map(view.teams.map((c) => [c.id, c]))
  return {
    short: (id: string) => by.get(id)?.short ?? id,
    name: (id: string) => by.get(id)?.name ?? id,
  }
}

// ---------- the front page strip ----------

/** The way in, under the stories. Never a score. Closed: how many more to read, and the way to the next story. */
export function sportStripHtml(label: string, matchday: number | null, lock: LockState, nextStory: number | null): string {
  if (!lock.open) {
    const togo = lock.needed - lock.counted
    return `<li class="sport-strip closed"><button class="strip-btn" data-go="${nextStory ?? 'front'}">
      <span class="strip-ico">${LOCK}</span>
      <span class="strip-text"><strong>Sport</strong><span class="meta">Opens after ${lock.needed} of today’s stories · ${togo} more to go</span></span>
      <span class="strip-go">Today’s paper ${icon('arrow')}</span>
    </button></li>`
  }
  return `<li class="sport-strip"><button class="strip-btn" data-act="sport">
    <span class="strip-ico">${icon('football')}</span>
    <span class="strip-text"><strong>Sport</strong><span class="meta">${esc(label)}${matchday ? ` · Matchday ${matchday}` : ''}</span></span>
    <span class="strip-go">Table, results, fixtures ${icon('arrow')}</span>
  </button></li>`
}

// ---------- the Sport screen ----------

const head = (back: string, note: string) =>
  `<header class="runhead">${back}<p class="word">Sport</p><p class="place">${esc(note)}</p></header>`
const toFront = `<button class="home" data-go="front">${icon('back')}Front page</button>`

function resultsNote(view: SportsView): string {
  if (view.results_to) return `Results to ${weekday(view.results_to)} ${dayMonth(view.results_to)}`
  return 'Premier League'
}

const tabsHtml = (tab: SportTab, view: SportsView) =>
  `<nav class="sport-tabs" aria-label="Sport">${(
    [
      ['matches', 'Matches', Boolean(view.matchday)],
      ['table', 'Table', Boolean(view.table)],
      ['next', 'Next', Boolean(view.next)],
    ] as const
  )
    .filter(([, , has]) => has)
    .map(([key, label]) => `<button class="sport-tab" data-sport="tab:${key}" aria-pressed="${key === tab}">${label}</button>`)
    .join('')}</nav>`

function teamHtml(name: string, fav: boolean, win: boolean): string {
  return `<span class="team${fav ? ' fav' : ''}${win ? ' win' : ''}">${fav ? '<span class="star" aria-label="Your team">★</span>' : ''}${esc(name)}</span>`
}

const goalText = (g: Goal, name: string) => `${esc(name)} ${esc(g.minute)}${g.kind === 'penalty' ? ' (pen)' : g.kind === 'own_goal' ? ' (o.g.)' : ''}`

function matchRow(view: SportsView, m: Match, results: boolean): string {
  const c = clubs(view)
  const fav = view.favourite_team
  const isFav = m.home === fav || m.away === fav
  const s = m.score
  const centre =
    m.state === 'finished' && s
      ? `<span class="score">${s.home} – ${s.away}</span>`
      : `<span class="score v">v</span>`
  const state =
    m.state === 'finished'
      ? m.detail
        ? `FT ${icon('arrow')}`
        : 'FT'
      : m.state === 'postponed'
        ? 'Postponed'
        : m.state === 'abandoned'
          ? 'Abandoned'
          : esc(kickoffTime(m.kickoff))
  const scorers =
    results && m.state === 'finished' && m.goals.length
      ? `<span class="scorers"><span class="h">${m.goals.filter((g) => g.side === 'home').map((g) => goalText(g, g.player)).join(', ')}</span><span class="a">${m.goals
          .filter((g) => g.side === 'away')
          .map((g) => goalText(g, g.player))
          .join(', ')}</span></span>`
      : ''
  const inner = `<span class="side-h">${teamHtml(c.short(m.home), m.home === fav, Boolean(s && s.home > s.away))}</span>${centre}<span class="side-a">${teamHtml(
    c.short(m.away),
    m.away === fav,
    Boolean(s && s.away > s.home),
  )}</span><span class="state">${state}</span>${scorers}`
  const cls = `match${isFav ? ' fav' : ''}`
  const label = `${c.name(m.home)} ${s && m.state === 'finished' ? `${s.home}, ${c.name(m.away)} ${s.away}` : `against ${c.name(m.away)}`}`
  return m.detail
    ? `<li><button class="${cls}" data-sport="match:${esc(m.id)}" aria-label="${esc(label)}. Open the match.">${inner}</button></li>`
    : `<li><div class="${cls}">${inner}</div></li>`
}

function daysHtml(view: SportsView, md: Matchday, results: boolean): string {
  return md.days
    .map(
      (d) =>
        `<section class="sport-day"><h2 class="day-head"><span class="kicker">${esc(weekday(d.date))}</span><span>${esc(dayMonth(d.date))}</span></h2><ol class="matches">${d.matches
          .map((m) => matchRow(view, m, results))
          .join('')}</ol></section>`,
    )
    .join('')
}

function tableHtml(view: SportsView): string {
  const t = view.table!
  const c = clubs(view)
  const cut = new Set(t.lines.map((l) => l.after))
  const row = (r: TableRow) => {
    const fav = r.team === view.favourite_team
    const gd = r.goal_difference > 0 ? `+${r.goal_difference}` : String(r.goal_difference)
    return `<tr class="${fav ? 'fav' : ''}${cut.has(r.position) ? ' cut' : ''}"><td class="pos">${r.position}</td><td class="club">${
      fav ? '<span class="star" aria-label="Your team">★</span>' : ''
    }${esc(c.short(r.team))}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${gd}</td><td class="pts">${r.points}</td></tr>`
  }
  const notes = t.lines.map((l) => `<span>${l.label === 'Relegation' ? `Below the line: relegation` : `Top ${l.after}: ${esc(l.label)}`}</span>`).join('')
  return `<table class="league"><caption class="kicker">${t.final ? 'Final table' : 'The table'}</caption>
    <thead><tr><th class="pos"><span class="sr">Position</span></th><th class="club">Club</th><th><abbr title="Played">P</abbr></th><th><abbr title="Won">W</abbr></th><th><abbr title="Drawn">D</abbr></th><th><abbr title="Lost">L</abbr></th><th><abbr title="Goal difference">GD</abbr></th><th class="pts"><abbr title="Points">Pts</abbr></th></tr></thead>
    <tbody>${t.rows.map(row).join('')}</tbody></table>${notes ? `<p class="zones">${notes}</p>` : ''}`
}

/** The page itself: three tabs, one shown. */
export function sportHtml(view: SportsView, tab: SportTab): string {
  let body: string
  if (tab === 'table' && view.table) body = tableHtml(view)
  else if (tab === 'next' && view.next) body = `<h2 class="sport-title">Matchday ${view.next.number}</h2>${daysHtml(view, view.next, false)}`
  else if (view.matchday) body = `<h2 class="sport-title">Matchday ${view.matchday.number}</h2>${daysHtml(view, view.matchday, true)}`
  else if (view.next) body = `<h2 class="sport-title">The season starts soon</h2>${daysHtml(view, view.next, false)}`
  else body = '<p class="quiet">The scores aren’t here yet.</p>'
  return `<section class="screen sport" data-topic="football">${head(toFront, resultsNote(view))}<div class="screen-body">
    <p class="sport-flag">${icon('football')}Premier League</p>
    ${tabsHtml(tab, view)}${body}
  </div></section>`
}

// ---------- a match ----------

const pair = (label: string, side: (s: Side) => string) =>
  `<section class="m-part"><h2 class="kicker">${label}</h2><div class="m-two"><div>${side('home')}</div><div>${side('away')}</div></div></section>`
const none = '<p class="m-none">None</p>'
const minuteRows = (rows: { minute: string; html: string }[]) =>
  rows.length ? `<ul class="m-list">${rows.map((r) => `<li><span class="m-min">${esc(r.minute)}</span><span>${r.html}</span></li>`).join('')}</ul>` : none

const LINE_NAMES: Record<string, string> = { goalkeeper: 'Goalkeeper', defenders: 'Defenders', midfielders: 'Midfielders', forwards: 'Forwards' }

function lineup(d: MatchDetail, side: Side, teamName: string): string {
  const l = d.lineups[side]
  const p = (x: Player) =>
    `<li><span class="m-num">${esc(x.number ?? '')}</span><span>${esc(x.name)}</span><span class="m-sub">${x.off ? `↓ ${esc(x.off)}` : x.on ? `↑ ${esc(x.on)}` : ''}</span></li>`
  return `<h3 class="m-team">${esc(teamName)}</h3>${l.starting
    .map((g) => `<p class="m-line">${LINE_NAMES[g.line] ?? ''}</p><ul class="m-xi">${g.players.map(p).join('')}</ul>`)
    .join('')}${l.bench.length ? `<p class="m-line">Substitutes</p><ul class="m-xi">${l.bench.map(p).join('')}</ul>` : ''}`
}

export function matchHtml(view: SportsView, m: Match): string {
  const c = clubs(view)
  const d = m.detail!
  const s = m.score ?? { home: 0, away: 0 }
  const goals = (side: Side) => d.goals.filter((g) => g.side === side).map((g) => `<li>${goalText(g, g.player)}</li>`).join('')
  const injuries = (side: Side) => {
    const off = d.subs.filter((x) => x.side === side && x.injury).map((x) => `${esc(x.off)} ${esc(x.minute)}`)
    const out = d.out_injured[side].map(esc)
    if (!off.length && !out.length) return none
    return `${off.length ? `<p class="m-line">Went off injured</p><p class="m-names">${off.join(', ')}</p>` : ''}${
      out.length ? `<p class="m-line">Out injured</p><p class="m-names">${out.join(', ')}</p>` : ''
    }`
  }
  const anyInjury = d.subs.some((x) => x.injury) || d.out_injured.home.length + d.out_injured.away.length > 0
  return `<section class="screen sport match-screen" data-topic="football">${head(
    `<button class="home" data-sport="tab:matches">${icon('back')}Matches</button>`,
    `Matchday ${view.matchday?.number ?? ''}`,
  )}<div class="screen-body">
    <div class="m-score">
      <p class="m-name h">${m.home === view.favourite_team ? '<span class="star" aria-label="Your team">★</span>' : ''}${esc(c.name(m.home))}</p>
      <p class="m-big">${s.home} – ${s.away}</p>
      <p class="m-name">${m.away === view.favourite_team ? '<span class="star" aria-label="Your team">★</span>' : ''}${esc(c.name(m.away))}</p>
    </div>
    <p class="m-when">Full time · ${esc(weekday(londonDay(m.kickoff)))} ${esc(dayMonth(londonDay(m.kickoff)))}</p>
    <div class="m-goals"><ul class="h">${goals('home')}</ul><ul>${goals('away')}</ul></div>
    ${
      d.penalties.length
        ? pair('Penalties missed', (side) =>
            minuteRows(d.penalties.filter((x) => x.side === side).map((x) => ({ minute: x.minute, html: `${esc(x.player)} <small>${x.outcome}</small>` }))),
          )
        : ''
    }
    ${
      d.cards.length
        ? pair('Cards', (side) =>
            minuteRows(
              d.cards
                .filter((x) => x.side === side)
                .map((x) => ({ minute: x.minute, html: `<i class="card ${x.card}" aria-label="${x.card} card"></i>${esc(x.player)}${x.card === 'red' ? ' <small>sent off</small>' : ''}` })),
            ),
          )
        : ''
    }
    ${
      d.subs.length
        ? pair('Substitutions', (side) =>
            minuteRows(d.subs.filter((x) => x.side === side).map((x) => ({ minute: x.minute, html: `↑ ${esc(x.on)}<br><span class="m-offname">↓ ${esc(x.off)}</span>` }))),
          )
        : ''
    }
    ${anyInjury ? pair('Injuries', injuries) : ''}
    ${pair('Line-ups', (side) => lineup(d, side, side === 'home' ? c.short(m.home) : c.short(m.away)))}
  </div></section>`
}

/** Sport is open but nothing has come from the server yet. */
export const sportEmptyHtml = () =>
  `<section class="screen sport" data-topic="football">${head(toFront, 'Premier League')}<div class="screen-body"><p class="quiet">The scores aren’t here yet. They come with the morning paper.</p></div></section>`

// ---------- closed ----------

/** Sport isn't open yet: how many stories, how far, and the way back to the paper. No scores behind it. */
export function sportClosedHtml(lock: LockState, nextStory: number | null): string {
  const togo = lock.needed - lock.counted
  return `<section class="screen sport" data-topic="football">${head(toFront, 'Premier League')}<div class="screen-body closed-body">
    <div class="sport-closed">
      <span class="padlock">${LOCK}</span>
      <h2>Sport opens after ${lock.needed} of today’s stories</h2>
      <p class="tally"><span class="pips" aria-hidden="true">${Array.from({ length: lock.needed }, (_, k) => `<i class="${k < lock.counted ? 'on' : ''}"></i>`).join('')}</span>${togo} more to go</p>
      <button class="btn go" data-go="${nextStory ?? 'front'}">Today’s paper ${icon('arrow')}</button>
    </div>
  </div></section>`
}
