/**
 * The Sport page's shapes (docs/sports-page.md section 5): what is kept in the state file, and the
 * `SportsView` the readers get from GET <mount>/api/sports.
 */

export type Side = "home" | "away";
export type MatchState = "scheduled" | "finished" | "postponed" | "abandoned";
export type Line = "goalkeeper" | "defenders" | "midfielders" | "forwards";

/** A club. `id` is our own slug ("man-utd"); `short` is for tight rows ("Man Utd"). */
export interface Club {
  id: string;
  name: string;
  short: string;
}

export interface Goal {
  side: Side;
  player: string;
  minute: string;
  kind: "goal" | "penalty" | "own_goal";
}

export interface Player {
  name: string;
  number: string | null;
  /** The minute a substitute came on, such as "72'". */
  on: string | null;
  /** The minute a starter went off. */
  off: string | null;
}

export interface Lineup {
  starting: { line: Line; players: Player[] }[];
  bench: Player[];
}

export interface Sub {
  side: Side;
  minute: string;
  on: string;
  off: string;
  /** Went off injured. */
  injury: boolean;
}

/** A played match's detail as fetched, before the injury snapshot is added. */
export interface FetchedDetail {
  goals: Goal[];
  penalties: { side: Side; player: string; minute: string; outcome: "missed" | "saved" }[];
  cards: { side: Side; player: string; minute: string; card: "yellow" | "red" }[];
  lineups: Record<Side, Lineup>;
  subs: Sub[];
}

export interface MatchDetail extends FetchedDetail {
  out_injured: Record<Side, string[]>;
}

export interface Score {
  home: number;
  away: number;
}

export interface StoredMatch {
  /** The Fantasy feed's fixture code: stable for the season, and known before kick-off. */
  id: string;
  /** ESPN's event id, once its scoreboard has been read; the key for its summary. */
  espn_id: string | null;
  kickoff: string;
  home: string;
  away: string;
  state: MatchState;
  score: Score | null;
  goals: Goal[];
}

export interface StoredRound {
  number: number;
  matches: StoredMatch[];
}

export interface TableRow {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goal_difference: number;
  points: number;
}

export interface Table {
  final: boolean;
  rows: TableRow[];
  /** A rule is drawn after these positions. */
  lines: { after: number; label: string }[];
}

/** $DATA/sports/premier-league.json: the last good state, one for the whole server. */
export interface SportsState {
  version: 1;
  /** The last fetch that got the rounds: the page's age. Null until one has worked. */
  fetched_at: string | null;
  /** The newest fetch, whether or not it worked. */
  attempted_at: string | null;
  /** What went wrong in the newest fetch; empty when everything worked. */
  errors: string[];
  clubs: Club[];
  latest: StoredRound | null;
  next: StoredRound | null;
  table: Table | null;
  /** Played matches of the latest round, by match id. Fetched once and kept. */
  details: Record<string, FetchedDetail>;
  /** Who was listed as injured on the morning of each match, by match id (latest and next rounds). */
  injuries: Record<string, Record<Side, string[]>>;
}

export const emptyState = (): SportsState => ({
  version: 1,
  fetched_at: null,
  attempted_at: null,
  errors: [],
  clubs: [],
  latest: null,
  next: null,
  table: null,
  details: {},
  injuries: {},
});

// ---- what the readers get (docs/sports-page.md 5.3) ----

export interface Match {
  id: string;
  kickoff: string;
  home: string;
  away: string;
  state: MatchState;
  score: Score | null;
  goals: Goal[];
  detail: MatchDetail | null;
}

export interface Matchday {
  number: number;
  /** London dates, oldest first. */
  days: { date: string; matches: Match[] }[];
}

export interface SportsView {
  competition: "Premier League";
  updated_at: string;
  /** London date of the latest played match in `matchday`, or null when none has been played. */
  results_to: string | null;
  favourite_team: string | null;
  teams: Club[];
  matchday: Matchday | null;
  next: Matchday | null;
  table: Table | null;
  /** Today's lock as the server sees it, from every device's reading; null when Sport isn't locked. */
  unlock: { needed: number; counted: number; unlocked: boolean } | null;
}

/** The issue payload's `sports` field: how the readers know the page is there. */
export interface IssueSports {
  path: "/api/sports";
  label: "Premier League";
  matchday: number | null;
  /** What the reader must read first, so it can decide offline; null when there is no lock. */
  unlock: { needed: number; min_seconds: Record<string, number> } | null;
}
