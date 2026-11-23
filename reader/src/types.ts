// The server's shapes the reader uses (CONTRACT.md "HTTP API" and "iPad reader").

export interface WordToKnow {
  word: string
  definition: string
}

export interface StoryImage {
  /** Server-relative to the mount, like `path`. */
  path: string
  alt: string | null
}

export interface ApiStory {
  id: number
  position: number
  topic: string
  title: string
  teaser: string
  minutes: number
  path: string
  word_to_know: WordToKnow | null
  image?: StoryImage | null
}

export interface Issue {
  date: string
  version: number
  fallback: boolean
  title: string
  number: number
  created_at: string
  stories: ApiStory[]
  hidden: number[]
  reading_since: string | null
  profile?: string
  profile_root?: boolean
  /** The Sport page, when this paper has one (docs/sports-page.md 5.3). Older servers leave it out. */
  sports?: IssueSports | null
}

// ---------- the Sport page (CONTRACT.md "Sport page") ----------

export interface IssueSports {
  path: string
  label: string
  matchday: number | null
  /** What must be read first: how many stories, and each one's least active seconds by story id. Null: no lock. */
  unlock: { needed: number; min_seconds: Record<string, number> } | null
}

export type Side = 'home' | 'away'

export interface Club {
  id: string
  name: string
  short: string
}

export interface Goal {
  side: Side
  player: string
  minute: string
  kind: 'goal' | 'penalty' | 'own_goal'
}

export interface Player {
  name: string
  number: string | null
  on: string | null
  off: string | null
}

export interface MatchDetail {
  goals: Goal[]
  penalties: { side: Side; player: string; minute: string; outcome: 'missed' | 'saved' }[]
  cards: { side: Side; player: string; minute: string; card: 'yellow' | 'red' }[]
  lineups: Record<Side, { starting: { line: 'goalkeeper' | 'defenders' | 'midfielders' | 'forwards'; players: Player[] }[]; bench: Player[] }>
  subs: { side: Side; minute: string; on: string; off: string; injury: boolean }[]
  out_injured: Record<Side, string[]>
}

export interface Match {
  id: string
  kickoff: string
  home: string
  away: string
  state: 'scheduled' | 'finished' | 'postponed' | 'abandoned'
  score: { home: number; away: number } | null
  goals: Goal[]
  detail: MatchDetail | null
}

export interface Matchday {
  number: number
  days: { date: string; matches: Match[] }[]
}

export interface TableRow {
  position: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goal_difference: number
  points: number
}

export interface SportsView {
  competition: string
  updated_at: string
  results_to: string | null
  favourite_team: string | null
  teams: Club[]
  matchday: Matchday | null
  next: Matchday | null
  table: { final: boolean; rows: TableRow[]; lines: { after: number; label: string }[] } | null
  /** Today's lock as the server sees it, from every device. */
  unlock: { needed: number; counted: number; unlocked: boolean } | null
}

export type ReaderMode = 'pages' | 'scroll'

export interface ReaderSettings {
  profile: string
  profile_root: boolean
  title: string
  mode: ReaderMode
  age: number
}

/** A story's text, taken from its story page. Paragraphs are safe HTML (text and <b> only). */
export interface StoryBody {
  paras: string[]
  word: WordToKnow | null
  think: string
  source: string
}
