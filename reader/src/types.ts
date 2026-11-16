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
