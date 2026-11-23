/**
 * The two free feeds behind the Sport page (docs/sports-page.md section 4), read into our own shapes.
 *
 * Every response is parsed against a schema that names only the fields used, so everything else the
 * feeds carry (odds, commentary, news, injury notes) is dropped on the way in. Provider text is only
 * ever used to set a flag (an injury substitution) and never kept. Names are cleaned (clubs.ts).
 */

import { z } from "zod";
import { USER_AGENT } from "../feeds.js";
import { cleanText, knownClub, normaliseName, unknownClub } from "./clubs.js";
import type { Club, FetchedDetail, Goal, Line, Lineup, Player, Score, Side, Sub, Table, TableRow } from "./types.js";

/** Gets a URL's JSON. Injectable so tests never touch the network. */
export type JsonFetcher = (url: string) => Promise<unknown>;

export const URLS = {
  fplBootstrap: "https://fantasy.premierleague.com/api/bootstrap-static/",
  fplFixtures: "https://fantasy.premierleague.com/api/fixtures/",
  espnStandings: "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings",
  /** One day at a time: ESPN refuses a date range for this league. `day` is YYYYMMDD. */
  espnScoreboard: (day: string) => `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=${day}`,
  espnSummary: (id: string) => `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=${encodeURIComponent(id)}`,
};

export async function httpFetchJson(url: string, timeoutMs = 20000): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

/** Parse or throw a short reason naming the feed, never the response itself. */
function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`${what} did not look as expected (${first?.path.join(".") || "(root)"}: ${first?.message})`);
  }
  return r.data;
}

/** "72'" or "45'+2'". Anything else is not a minute. */
const MINUTE = /^\d{1,3}'(\+\d{1,2}')?$/;
export const cleanMinute = (v: unknown): string | null => {
  const m = typeof v === "string" ? v.trim() : "";
  return MINUTE.test(m) ? m : null;
};

/** A score is a whole number from 0 to 20; anything else is not believed. */
export function cleanScore(home: unknown, away: unknown): Score | null {
  const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v) : NaN);
  const [h, a] = [n(home), n(away)];
  const ok = (x: number) => Number.isInteger(x) && x >= 0 && x <= 20;
  return ok(h) && ok(a) ? { home: h, away: a } : null;
}

const str = z.union([z.string(), z.number()]).transform(String);

// ---- Fantasy Premier League ----

const fplBootstrapSchema = z.object({
  teams: z.array(z.object({ id: z.number().int(), name: z.string(), short_name: z.string().nullish() })).min(1),
  elements: z.array(z.object({ web_name: z.string(), team: z.number().int(), status: z.string() })),
});

const fplFixturesSchema = z.array(
  z.object({
    code: z.number().int(),
    event: z.number().int().nullable(),
    kickoff_time: z.string().nullable(),
    team_h: z.number().int(),
    team_a: z.number().int(),
    team_h_score: z.number().int().nullish(),
    team_a_score: z.number().int().nullish(),
    finished: z.boolean().nullish(),
    /** Set at full time; `finished` follows days later, once the round is settled. */
    finished_provisional: z.boolean().nullish(),
  }),
).min(1);

export interface FplBootstrap {
  /** Fantasy team id to our club. */
  clubs: Map<number, Club>;
  /** Our club id to the names of its players listed as injured (status "i"), as the feed shortens them. */
  injured: Map<string, string[]>;
}

/**
 * The Fantasy feed's clubs, matched to ours by name, else to an ESPN club by the three-letter code
 * both feeds use, else kept under their own name.
 */
export function parseFplBootstrap(data: unknown, espnByCode: Map<string, Club> = new Map()): FplBootstrap {
  const b = parse(fplBootstrapSchema, data, "the Fantasy feed's clubs and players");
  const clubs = new Map<number, Club>();
  for (const t of b.teams) {
    const c = knownClub(t.name) ?? espnByCode.get((t.short_name ?? "").toUpperCase()) ?? unknownClub(t.name, t.name);
    if (!c) continue;
    if (!knownClub(t.name) && !espnByCode.has((t.short_name ?? "").toUpperCase())) console.warn(`sports: unknown club in the Fantasy feed: ${cleanText(t.name)}`);
    clubs.set(t.id, c);
  }
  const injured = new Map<string, string[]>();
  for (const p of b.elements) {
    if (p.status !== "i") continue;
    const club = clubs.get(p.team);
    const name = cleanText(p.web_name);
    if (!club || !name) continue;
    injured.set(club.id, [...(injured.get(club.id) ?? []), name]);
  }
  return { clubs, injured };
}

export interface FplFixture {
  id: string;
  round: number | null;
  kickoff: string | null;
  home: string;
  away: string;
  finished: boolean;
  score: Score | null;
}

export function parseFplFixtures(data: unknown, clubs: Map<number, Club>): FplFixture[] {
  const out: FplFixture[] = [];
  for (const f of parse(fplFixturesSchema, data, "the Fantasy feed's fixtures")) {
    const home = clubs.get(f.team_h);
    const away = clubs.get(f.team_a);
    if (!home || !away) continue;
    const kickoff = f.kickoff_time && !Number.isNaN(Date.parse(f.kickoff_time)) ? new Date(f.kickoff_time).toISOString() : null;
    const finished = f.finished === true || f.finished_provisional === true;
    out.push({
      id: String(f.code),
      round: f.event,
      kickoff,
      home: home.id,
      away: away.id,
      finished,
      score: finished ? cleanScore(f.team_h_score, f.team_a_score) : null,
    });
  }
  return out;
}

// ---- ESPN ----

const espnTeam = z.object({
  id: str,
  displayName: z.string(),
  shortDisplayName: z.string().nullish(),
  abbreviation: z.string().nullish(),
});

const espnStandingsSchema = z.object({
  children: z
    .array(
      z.object({
        standings: z.object({
          entries: z.array(
            z.object({
              team: espnTeam,
              note: z.object({ description: z.string().nullish() }).nullish(),
              stats: z.array(z.object({ name: z.string(), value: z.number().nullish() })),
            }),
          ),
        }),
      }),
    )
    .min(1),
});

/** An ESPN team as one of our clubs. */
export function espnClub(t: { displayName: string; shortDisplayName?: string | null; abbreviation?: string | null }): Club | null {
  const c = knownClub(t.displayName, t.shortDisplayName);
  if (c) return c;
  console.warn(`sports: unknown club in the ESPN feed: ${cleanText(t.displayName)}`);
  return unknownClub(t.displayName, t.shortDisplayName);
}

export interface EspnStandings {
  table: Table;
  /** ESPN team id to our club. */
  clubs: Map<string, Club>;
  /** The three-letter code to our club, for matching the Fantasy feed's clubs the table doesn't know. */
  byCode: Map<string, Club>;
}

/** Which places ESPN marks as a zone, as rules: after the last Champions League place, before the first relegation place. */
function zoneLines(marks: { position: number; note: string }[]): Table["lines"] {
  const lines: Table["lines"] = [];
  const cl = marks.filter((m) => /champions league/i.test(m.note)).map((m) => m.position);
  const rel = marks.filter((m) => /relegat/i.test(m.note)).map((m) => m.position);
  if (cl.length) lines.push({ after: Math.max(...cl), label: "Champions League" });
  if (rel.length && Math.min(...rel) > 1) lines.push({ after: Math.min(...rel) - 1, label: "Relegation" });
  return lines;
}

export function parseEspnStandings(data: unknown): EspnStandings {
  const s = parse(espnStandingsSchema, data, "ESPN's table");
  const entries = s.children[0].standings.entries;
  const clubs = new Map<string, Club>();
  const byCode = new Map<string, Club>();
  const rows: TableRow[] = [];
  const marks: { position: number; note: string }[] = [];
  for (const e of entries) {
    const club = espnClub(e.team);
    if (!club) continue;
    clubs.set(e.team.id, club);
    if (e.team.abbreviation) byCode.set(e.team.abbreviation.toUpperCase(), club);
    const stat = Object.fromEntries(e.stats.map((x) => [x.name, x.value]));
    const int = (k: string) => (typeof stat[k] === "number" && Number.isInteger(stat[k]) ? (stat[k] as number) : NaN);
    const row: TableRow = {
      position: int("rank"),
      team: club.id,
      played: int("gamesPlayed"),
      won: int("wins"),
      drawn: int("ties"),
      lost: int("losses"),
      goal_difference: int("pointDifferential"),
      points: int("points"),
    };
    if (Object.values(row).some((v) => typeof v === "number" && !Number.isFinite(v))) throw new Error("ESPN's table has a row without its numbers");
    rows.push(row);
    if (e.note?.description) marks.push({ position: row.position, note: e.note.description });
  }
  rows.sort((a, b) => a.position - b.position);
  if (rows.length < 2 || rows.length > 30) throw new Error(`ESPN's table has ${rows.length} rows`);
  return { table: { final: false, rows, lines: zoneLines(marks) }, clubs, byCode };
}

const espnScoreboardSchema = z.object({
  events: z.array(
    z.object({
      id: str,
      date: z.string(),
      status: z.object({ type: z.object({ name: z.string(), completed: z.boolean().nullish() }) }),
      competitions: z
        .array(
          z.object({
            competitors: z.array(z.object({ homeAway: z.enum(["home", "away"]), score: str.nullish(), team: espnTeam })).length(2),
            details: z
              .array(
                z.object({
                  clock: z.object({ displayValue: z.string().nullish() }).nullish(),
                  team: z.object({ id: str }).nullish(),
                  scoringPlay: z.boolean().nullish(),
                  penaltyKick: z.boolean().nullish(),
                  ownGoal: z.boolean().nullish(),
                  athletesInvolved: z.array(z.object({ displayName: z.string() })).nullish(),
                }),
              )
              .nullish(),
          }),
        )
        .min(1),
    }),
  ),
});

export interface EspnMatch {
  espn_id: string;
  home: string;
  away: string;
  state: "finished" | "postponed" | "abandoned" | "other";
  score: Score | null;
  goals: Goal[];
}

function espnState(name: string, completed: boolean): EspnMatch["state"] {
  if (/POSTPONED|CANCELED|CANCELLED/.test(name)) return "postponed";
  if (/ABANDONED|SUSPENDED|FORFEIT/.test(name)) return "abandoned";
  if (completed) return "finished";
  return "other";
}

/**
 * Own goals: ESPN may file one under either club. When the goals don't add up to the score and
 * moving the own goals across makes them add up, move them.
 */
export function settleOwnGoals(goals: Goal[], score: Score | null): Goal[] {
  if (!score) return goals;
  const count = (gs: Goal[], side: Side) => gs.filter((g) => g.side === side).length;
  if (count(goals, "home") === score.home && count(goals, "away") === score.away) return goals;
  const flipped = goals.map((g) => (g.kind === "own_goal" ? { ...g, side: (g.side === "home" ? "away" : "home") as Side } : g));
  if (count(flipped, "home") === score.home && count(flipped, "away") === score.away) return flipped;
  return goals;
}

const surname = (name: string) => {
  const parts = name.split(" ");
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
};

/** One day's matches. Goals under a result use surnames, as a newspaper prints them. */
export function parseEspnScoreboard(data: unknown): EspnMatch[] {
  const s = parse(espnScoreboardSchema, data, "ESPN's scores");
  const out: EspnMatch[] = [];
  for (const e of s.events) {
    const c = e.competitions[0];
    const home = c.competitors.find((x) => x.homeAway === "home");
    const away = c.competitors.find((x) => x.homeAway === "away");
    if (!home || !away) continue;
    const homeClub = espnClub(home.team);
    const awayClub = espnClub(away.team);
    if (!homeClub || !awayClub) continue;
    const state = espnState(e.status.type.name, e.status.type.completed === true);
    const score = state === "finished" ? cleanScore(home.score, away.score) : null;
    const goals: Goal[] = [];
    for (const d of c.details ?? []) {
      if (!d.scoringPlay) continue;
      const player = cleanText(d.athletesInvolved?.[0]?.displayName ?? "");
      const minute = cleanMinute(d.clock?.displayValue);
      if (!player || !minute || !d.team) continue;
      goals.push({
        side: d.team.id === home.team.id ? "home" : "away",
        player: surname(player),
        minute,
        kind: d.ownGoal ? "own_goal" : d.penaltyKick ? "penalty" : "goal",
      });
    }
    out.push({
      espn_id: e.id,
      home: homeClub.id,
      away: awayClub.id,
      // A finished match whose score can't be believed is shown as not played rather than wrongly.
      state: state === "finished" && !score ? "other" : state,
      score,
      goals: state === "finished" && score ? settleOwnGoals(goals, score) : [],
    });
  }
  return out;
}

const espnSummarySchema = z.object({
  rosters: z
    .array(
      z.object({
        homeAway: z.enum(["home", "away"]),
        team: z.object({ id: str }),
        roster: z.array(
          z.object({
            starter: z.boolean().nullish(),
            jersey: str.nullish(),
            athlete: z.object({ displayName: z.string() }),
            position: z.object({ abbreviation: z.string().nullish() }).nullish(),
            subbedIn: z.boolean().nullish(),
            subbedOut: z.boolean().nullish(),
            plays: z
              .array(z.object({ clock: z.object({ displayValue: z.string().nullish() }).nullish(), substitution: z.boolean().nullish() }))
              .nullish(),
          }),
        ),
      }),
    )
    .length(2),
  keyEvents: z
    .array(
      z.object({
        type: z.object({ type: z.string().nullish(), text: z.string().nullish() }).nullish(),
        text: z.string().nullish(),
        clock: z.object({ displayValue: z.string().nullish() }).nullish(),
        team: z.object({ id: str }).nullish(),
        scoringPlay: z.boolean().nullish(),
        participants: z.array(z.object({ athlete: z.object({ displayName: z.string() }) })).nullish(),
      }),
    )
    .nullish(),
});

/** ESPN's position codes ("G", "CD-L", "RB", "DM", "AM-R", "CF") as lines of the team. */
export function lineFor(code: string | null | undefined): Line {
  const c = (code ?? "").toUpperCase();
  if (c === "G" || c === "GK") return "goalkeeper";
  if (c === "D" || /^(CD|CB|SW)(-|$)/.test(c) || /^[LR]W?B(-|$)/.test(c)) return "defenders";
  if (/M/.test(c)) return "midfielders";
  if (/^(F|CF|ST|S|[LR]W|[LR]F)(-|$)/.test(c)) return "forwards";
  return "midfielders";
}

const LINES: Line[] = ["goalkeeper", "defenders", "midfielders", "forwards"];

/**
 * A played match: line-ups from `rosters`, everything else from `keyEvents` (the roster's own `plays`
 * mark an assister as a scorer, so goals are never read from it). Free text in an event is used only
 * to tell an injury substitution, then dropped.
 */
export function parseEspnSummary(data: unknown, score: Score | null = null): FetchedDetail {
  const s = parse(espnSummarySchema, data, "ESPN's match summary");
  const sideOf = new Map<string, Side>(s.rosters.map((r) => [r.team.id, r.homeAway]));
  const lineups = {} as Record<Side, Lineup>;
  for (const r of s.rosters) {
    const starting = new Map<Line, Player[]>(LINES.map((l) => [l, []]));
    const bench: Player[] = [];
    for (const p of r.roster) {
      const name = cleanText(p.athlete.displayName);
      if (!name) continue;
      const subMinute = cleanMinute((p.plays ?? []).find((x) => x.substitution)?.clock?.displayValue);
      const jersey = cleanText(p.jersey ?? "", 3);
      const player: Player = {
        name,
        number: /^\d{1,3}$/.test(jersey) ? jersey : null,
        on: p.subbedIn ? subMinute : null,
        off: p.subbedOut ? subMinute : null,
      };
      if (p.starter) starting.get(lineFor(p.position?.abbreviation))!.push(player);
      else bench.push(player);
    }
    lineups[r.homeAway] = { starting: LINES.map((line) => ({ line, players: starting.get(line)! })).filter((g) => g.players.length), bench };
  }

  const goals: Goal[] = [];
  const penalties: FetchedDetail["penalties"] = [];
  const cards: FetchedDetail["cards"] = [];
  const subs: Sub[] = [];
  for (const k of s.keyEvents ?? []) {
    const type = (k.type?.type ?? "").toLowerCase();
    const side = k.team ? sideOf.get(k.team.id) : undefined;
    const minute = cleanMinute(k.clock?.displayValue);
    const names = (k.participants ?? []).map((p) => cleanText(p.athlete.displayName));
    if (!side || !minute) continue;
    const player = names[0] ?? "";
    if (type === "substitution") {
      if (!names[0] || !names[1]) continue;
      // The only use of ESPN's own words: "... replaces X because of an injury."
      subs.push({ side, minute, on: names[0], off: names[1], injury: /because of an injury/i.test(k.text ?? "") });
    } else if (type.includes("card")) {
      if (!player) continue;
      if (type.includes("yellow")) cards.push({ side, player, minute, card: "yellow" });
      if (type.includes("red")) cards.push({ side, player, minute, card: "red" });
    } else if (type.includes("penalty") && !type.includes("scored")) {
      if (!player) continue;
      penalties.push({ side, player, minute, outcome: type.includes("saved") ? "saved" : "missed" });
    } else if (k.scoringPlay || type.startsWith("goal") || type.includes("own-goal") || type === "penalty---scored") {
      if (!player) continue;
      goals.push({ side, player, minute, kind: type.includes("own") ? "own_goal" : type.includes("penalty") ? "penalty" : "goal" });
    }
  }
  return { goals: settleOwnGoals(goals, score), penalties, cards, lineups, subs };
}

/**
 * Whether a name on the injury list (the Fantasy feed's short name, usually a surname) is someone in
 * this squad (ESPN's full names). Matched on the end of the name only, so that Conor Bradley on the
 * list isn't mistaken for Bradley Barcola on the pitch.
 */
export function inSquad(listed: string, squad: string[]): boolean {
  const want = normaliseName(listed);
  if (!want) return false;
  return squad.some((full) => {
    const n = normaliseName(full);
    return n === want || n.endsWith(` ${want}`);
  });
}
