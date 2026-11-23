/**
 * The Sport page for one profile (docs/sports-page.md 5.3): the stored state grouped by London day,
 * with his club marked, the injury lists settled and blocklisted names left out.
 */

import type { Config } from "../config.js";
import { blocklistHits, compileBlocklist } from "../feeds.js";
import { londonDate } from "../timeutil.js";
import { namesClub } from "./clubs.js";
import { inSquad } from "./feeds.js";
import type { IssueSports, Match, MatchDetail, Matchday, Side, SportsState, SportsView, StoredMatch, StoredRound } from "./types.js";

/** After this long without a good fetch the page is taken down rather than shown out of date. */
export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

export function isFresh(state: SportsState, now: Date): boolean {
  if (!state.fetched_at) return false;
  return now.getTime() - Date.parse(state.fetched_at) <= STALE_AFTER_MS;
}

/** Everyone named in a match's line-ups. */
function squad(detail: MatchDetail | Omit<MatchDetail, "out_injured">, side: Side): string[] {
  const l = detail.lineups[side];
  return l ? [...l.starting.flatMap((g) => g.players), ...l.bench].map((p) => p.name) : [];
}

function withoutBlocked<T>(items: T[], name: (t: T) => string[], pattern: RegExp | null): T[] {
  if (!pattern) return items;
  return items.filter((t) => name(t).every((n) => blocklistHits(pattern, n).length === 0));
}

function matchView(m: StoredMatch, state: SportsState, pattern: RegExp | null): Match {
  const fetched = m.state === "finished" ? state.details[m.id] : undefined;
  let detail: MatchDetail | null = null;
  if (fetched) {
    const snapshot = state.injuries[m.id] ?? { home: [], away: [] };
    const out = (side: Side) => withoutBlocked(snapshot[side].filter((n) => !inSquad(n, squad(fetched, side))), (n) => [n], pattern);
    const players = (ps: MatchDetail["lineups"][Side]["bench"]) => withoutBlocked(ps, (p) => [p.name], pattern);
    const lineup = (side: Side) => ({
      starting: fetched.lineups[side].starting.map((g) => ({ line: g.line, players: players(g.players) })),
      bench: players(fetched.lineups[side].bench),
    });
    detail = {
      goals: withoutBlocked(fetched.goals, (g) => [g.player], pattern),
      penalties: withoutBlocked(fetched.penalties, (p) => [p.player], pattern),
      cards: withoutBlocked(fetched.cards, (c) => [c.player], pattern),
      lineups: { home: lineup("home"), away: lineup("away") },
      subs: withoutBlocked(fetched.subs, (s) => [s.on, s.off], pattern),
      out_injured: { home: out("home"), away: out("away") },
    };
  }
  return {
    id: m.id,
    kickoff: m.kickoff,
    home: m.home,
    away: m.away,
    state: m.state,
    score: m.state === "finished" ? m.score : null,
    goals: m.state === "finished" ? withoutBlocked(m.goals, (g) => [g.player], pattern) : [],
    detail,
  };
}

function matchday(round: StoredRound | null, state: SportsState, pattern: RegExp | null, details: boolean): Matchday | null {
  if (!round) return null;
  const days = new Map<string, Match[]>();
  for (const m of round.matches) {
    const date = londonDate(new Date(m.kickoff));
    const view = matchView(m, state, pattern);
    days.set(date, [...(days.get(date) ?? []), details ? view : { ...view, detail: null }]);
  }
  return {
    number: round.number,
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, matches]) => ({ date, matches })),
  };
}

/** The page for one profile, or null when there is nothing current to show. */
export function sportsView(state: SportsState, config: Config, now: Date): SportsView | null {
  if (!isFresh(state, now) || (!state.latest && !state.next)) return null;
  const pattern = compileBlocklist(config.blocklist);
  const played = (state.latest?.matches ?? []).filter((m) => m.state === "finished").map((m) => londonDate(new Date(m.kickoff)));
  const favourite = config.favouriteTeam ? state.clubs.find((c) => namesClub(c, config.favouriteTeam)) : undefined;
  return {
    competition: "Premier League",
    updated_at: state.fetched_at!,
    results_to: played.length ? played.sort().at(-1)! : null,
    favourite_team: favourite?.id ?? null,
    teams: state.clubs,
    matchday: matchday(state.latest, state, pattern, true),
    next: matchday(state.next, state, pattern, false),
    table: state.latest ? state.table : null,
    unlock: null,
  };
}

export function issueSports(state: SportsState, now: Date): IssueSports | null {
  if (!isFresh(state, now) || (!state.latest && !state.next)) return null;
  return { path: "/api/sports", label: "Premier League", matchday: state.latest?.number ?? state.next?.number ?? null, unlock: null };
}

/** "Liverpool 4–0 Man Utd", or "Brentford v Everton" before it is played; null for a match not in the state. */
export function matchLabel(state: SportsState, id: string): string | null {
  const m = [...(state.latest?.matches ?? []), ...(state.next?.matches ?? [])].find((x) => x.id === id);
  if (!m) return null;
  const name = (club: string) => state.clubs.find((c) => c.id === club)?.short ?? club;
  return m.state === "finished" && m.score ? `${name(m.home)} ${m.score.home}–${m.score.away} ${name(m.away)}` : `${name(m.home)} v ${name(m.away)}`;
}
