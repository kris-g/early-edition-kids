/**
 * The daily fetch (docs/sports-page.md section 3): read both feeds and work out the latest round,
 * the next one, the table, each played match's detail and the morning's injury lists.
 *
 * Each part is kept or dropped on its own (section 7): a broken response leaves that part as it was
 * in the previous state, and is named in `errors`.
 */

import {
  URLS,
  parseEspnScoreboard,
  parseEspnStandings,
  parseEspnSummary,
  parseFplBootstrap,
  parseFplFixtures,
  type EspnMatch,
  type EspnStandings,
  type FplBootstrap,
  type FplFixture,
  type JsonFetcher,
} from "./feeds.js";
import type { Club, FetchedDetail, Side, SportsState, StoredMatch, StoredRound, Table } from "./types.js";

const short = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

interface RoundInfo {
  number: number;
  first: number;
  fixtures: FplFixture[];
}

/** The Fantasy feed's fixtures as rounds, ordered by number; fixtures without a round or time are left out. */
export function roundsFrom(fixtures: FplFixture[]): RoundInfo[] {
  const by = new Map<number, FplFixture[]>();
  for (const f of fixtures) {
    if (f.round === null || f.kickoff === null) continue;
    by.set(f.round, [...(by.get(f.round) ?? []), f]);
  }
  return [...by.entries()]
    .map(([number, fs]) => ({ number, first: Math.min(...fs.map((f) => Date.parse(f.kickoff!))), fixtures: fs }))
    .sort((a, b) => a.number - b.number);
}

/**
 * The latest round is the one whose first match kicked off most recently; the next is the round
 * after it, or before the season the first one to start.
 */
export function pickRounds(rounds: RoundInfo[], now: Date): { latest: RoundInfo | null; next: RoundInfo | null } {
  const t = now.getTime();
  const started = rounds.filter((r) => r.first <= t);
  const latest = started.length ? started.reduce((a, b) => (b.first > a.first ? b : a)) : null;
  if (latest) return { latest, next: rounds.find((r) => r.number === latest.number + 1) ?? null };
  const upcoming = rounds.filter((r) => r.first > t).sort((a, b) => a.first - b.first);
  return { latest: null, next: upcoming[0] ?? null };
}

const byKickoff = (a: StoredMatch, b: StoredMatch) => a.kickoff.localeCompare(b.kickoff) || a.home.localeCompare(b.home);

/** A round as stored: the Fantasy feed's matches, with ESPN's result laid over each one it has. */
function storeRound(round: RoundInfo, espn: Map<string, EspnMatch>, prev: Map<string, StoredMatch>, now: Date): StoredRound | null {
  if (round.fixtures.length < 1 || round.fixtures.length > 10) return null;
  const matches = round.fixtures.map((f): StoredMatch => {
    // A match is only believed played once its kick-off has passed.
    const played = f.finished && Date.parse(f.kickoff!) <= now.getTime();
    const base: StoredMatch = {
      id: f.id,
      espn_id: null,
      kickoff: f.kickoff!,
      home: f.home,
      away: f.away,
      state: played && f.score ? "finished" : "scheduled",
      score: played ? f.score : null,
      goals: [],
    };
    const e = espn.get(`${f.home}|${f.away}`);
    if (e) {
      base.espn_id = e.espn_id;
      if (e.state === "finished" && e.score) Object.assign(base, { state: "finished", score: e.score, goals: e.goals });
      else if (e.state === "postponed" || e.state === "abandoned") Object.assign(base, { state: e.state, score: null, goals: [] });
      return base;
    }
    // No word from ESPN today (its day failed, or the match isn't on its scoreboard): keep what we had.
    const old = prev.get(f.id);
    if (old && old.home === f.home && old.away === f.away) return { ...old, kickoff: f.kickoff! };
    return base;
  });
  return { number: round.number, matches: matches.sort(byKickoff) };
}

/** UTC days (YYYYMMDD) on which the round's matches have kicked off. */
function playedDays(round: RoundInfo, now: Date): string[] {
  const days = new Set<string>();
  for (const f of round.fixtures) {
    const k = Date.parse(f.kickoff!);
    if (k <= now.getTime()) days.add(new Date(k).toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return [...days].sort();
}

/** Clubs named anywhere in the state, for the view's `teams`. */
function clubsIn(state: Pick<SportsState, "latest" | "next" | "table">, known: Club[]): Club[] {
  const ids = new Set<string>();
  for (const r of [state.latest, state.next]) for (const m of r?.matches ?? []) ids.add(m.home).add(m.away);
  for (const row of state.table?.rows ?? []) ids.add(row.team);
  const byId = new Map(known.map((c) => [c.id, c]));
  return [...ids].map((id) => byId.get(id)).filter((c): c is Club => Boolean(c)).sort((a, b) => a.short.localeCompare(b.short));
}

/** One fetch. Never throws: what failed is in the returned state's `errors`. */
export async function refreshState(prev: SportsState, fetchJson: JsonFetcher, now: Date): Promise<SportsState> {
  const errors: string[] = [];
  const known = new Map(prev.clubs.map((c) => [c.id, c]));
  const remember = (c: Club) => known.set(c.id, c);

  let standings: EspnStandings | null = null;
  try {
    standings = parseEspnStandings(await fetchJson(URLS.espnStandings));
    standings.clubs.forEach(remember);
  } catch (err) {
    errors.push(`table: ${short(err)}`);
  }

  let bootstrap: FplBootstrap | null = null;
  try {
    bootstrap = parseFplBootstrap(await fetchJson(URLS.fplBootstrap), standings?.byCode);
    bootstrap.clubs.forEach(remember);
  } catch (err) {
    errors.push(`clubs and injuries: ${short(err)}`);
  }

  let fixtures: FplFixture[] | null = null;
  if (bootstrap) {
    try {
      fixtures = parseFplFixtures(await fetchJson(URLS.fplFixtures), bootstrap.clubs);
    } catch (err) {
      errors.push(`fixtures: ${short(err)}`);
    }
  }

  let latest = prev.latest;
  let next = prev.next;
  let fetchedAt = prev.fetched_at;
  let final = prev.table?.final ?? false;
  if (fixtures) {
    const rounds = roundsFrom(fixtures);
    const picked = pickRounds(rounds, now);
    const espn = new Map<string, EspnMatch>();
    if (picked.latest) {
      for (const day of playedDays(picked.latest, now)) {
        try {
          for (const m of parseEspnScoreboard(await fetchJson(URLS.espnScoreboard(day)))) espn.set(`${m.home}|${m.away}`, m);
        } catch (err) {
          errors.push(`scores for ${day}: ${short(err)}`);
        }
      }
    }
    const prevMatches = new Map([...(prev.latest?.matches ?? []), ...(prev.next?.matches ?? [])].map((m) => [m.id, m]));
    latest = picked.latest ? storeRound(picked.latest, espn, prevMatches, now) : null;
    next = picked.next ? storeRound(picked.next, new Map(), new Map(), now) : null;
    if (picked.latest && !latest) errors.push(`round ${picked.latest.number} has an unlikely number of matches`);
    fetchedAt = now.toISOString();
    final = fixtures.length > 0 && fixtures.every((f) => f.finished) && !next;
  }

  const table: Table | null = standings ? { ...standings.table, final } : prev.table ? { ...prev.table, final } : null;

  // Details: kept for matches still in the latest round, fetched once for newly played ones.
  const details: Record<string, FetchedDetail> = {};
  for (const m of latest?.matches ?? []) {
    if (m.state !== "finished") continue;
    if (prev.details[m.id]) {
      details[m.id] = prev.details[m.id];
      continue;
    }
    if (!m.espn_id) continue;
    try {
      details[m.id] = parseEspnSummary(await fetchJson(URLS.espnSummary(m.espn_id)), m.score);
    } catch (err) {
      errors.push(`match ${m.espn_id}: ${short(err)}`);
    }
  }

  // Injury lists: taken each morning for matches still to come; kept once a match has kicked off.
  const injuries: SportsState["injuries"] = {};
  for (const m of [...(latest?.matches ?? []), ...(next?.matches ?? [])]) {
    const upcoming = Date.parse(m.kickoff) > now.getTime();
    if (upcoming && bootstrap) {
      const list = (club: string) => [...(bootstrap!.injured.get(club) ?? [])];
      injuries[m.id] = { home: list(m.home), away: list(m.away) } as Record<Side, string[]>;
    } else if (prev.injuries[m.id]) {
      injuries[m.id] = prev.injuries[m.id];
    }
  }

  const partial = { latest, next, table };
  return {
    version: 1,
    fetched_at: fetchedAt,
    attempted_at: now.toISOString(),
    errors,
    clubs: clubsIn(partial, [...known.values()]),
    latest,
    next,
    table,
    details,
    injuries,
  };
}
