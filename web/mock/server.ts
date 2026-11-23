// Mock of the dashboard JSON API (CONTRACT.md, "Parent dashboard (React PWA)").
// For developing and testing the web app without the real server.
//
//   npm run mock                   # http://localhost:8090
//   MOCK_NO_ISSUE=1 npm run mock   # no issue today (empty state)
//   MOCK_PROFILES=older,younger npm run dev:mock
//                                  # two children: /dashboard/p/<id>/, a switcher in the header
//   MOCK_LOGIN=1 npm run dev:mock  # as if DASHBOARD_PASSWORD were set: "Sign out" in the sidebar and on More
//
// To see what happens when the Authelia session expires, open
// http://localhost:8090/__mock/signed-out?on=1 (and ?on=0 to undo): every
// /api/dashboard request then answers with a 302 to a fake sign-in page.
//
// Env: PORT (8090), MOCK_DELAY ms (250), MOCK_JOB_MS (4000).
import { randomUUID } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import type { AboutView, Job } from '../src/api/types.ts'
import {
  ARCHIVE,
  TEMPLATES,
  TOPICS,
  addDays,
  db,
  failureReasons,
  issueStories,
  londonToday,
  makeStory,
  seedProfiles,
  streakAndWeek,
  templateFor,
  toCard,
  toDetail,
  toIssueView,
  topicViews,
  type Template,
  useProfile,
} from './data.ts'
import { aiView, lastRunCost, updateAi } from './ai.ts'
import { calendarView, readingView, shareView, streak } from './stats.ts'

const PORT = Number(process.env.PORT ?? 8090)
const DELAY = Number(process.env.MOCK_DELAY ?? 250)
const JOB_MS = Number(process.env.MOCK_JOB_MS ?? 4000)

// Children: one "default" (the single-child app) unless MOCK_PROFILES lists several.
const PROFILES = (process.env.MOCK_PROFILES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const MULTI = PROFILES.length > 0
const IDS = MULTI ? PROFILES : ['default']
const TITLES = ['Early Edition', 'Little Edition', 'Junior Edition']
const LOGIN = process.env.MOCK_LOGIN === '1'
seedProfiles(IDS, { noIssueToday: process.env.MOCK_NO_ISSUE === '1' })

let signedOut = false
type JobEntry = { job: Job; readyAt: number; url: string; title: string | null; summary: string | null; profile: string }
const jobs = new Map<string, JobEntry>()

const app = express()
app.disable('x-powered-by')
app.use(express.json())

// /api/dashboard/p/<id>/... is that child's API; /api/dashboard/... is the first child's.
declare module 'express-serve-static-core' {
  interface Request {
    profile?: string
  }
}
app.use((req, _res, next) => {
  const m = req.url.match(/^\/api\/dashboard\/p\/([^/?]+)(.*)$/)
  if (m) {
    req.profile = decodeURIComponent(m[1])
    req.url = '/api/dashboard' + (m[2] || '/')
  } else if (req.url.startsWith('/api/dashboard')) {
    req.profile = IDS[0]
  }
  next()
})

// The sign-in stand-in: POST /logout signs out and lands on a plain page.
app.post('/logout', (_req, res) => {
  res.redirect(303, '/login')
})
app.get('/login', (_req, res) => {
  res.type('html').send('<!doctype html><title>Sign in</title><p>The mock has no real sign-in. <a href="/dashboard/">Back to the dashboard</a></p>')
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error })

// Latency, so loading states are visible.
app.use('/api', (_req, _res, next) => {
  void sleep(DELAY).then(() => next())
})

// --- Authelia stand-in and the CSRF guard ----------------------------------
app.get('/__mock/signed-out', (req, res) => {
  signedOut = req.query.on !== '0'
  res.type('text').send(signedOut ? 'API now answers as if the Authelia session expired.' : 'Signed back in.')
})

app.use('/api/dashboard', (req: Request, res: Response, next: NextFunction) => {
  if (signedOut) {
    res.redirect(302, 'https://auth.example.test/?rd=' + encodeURIComponent(req.originalUrl))
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-early-edition') !== '1') {
    return fail(res, 403, 'Missing X-Early-Edition header.')
  }
  next()
})

app.get('/api/dashboard/profiles', (_req, res) => {
  res.json({
    profiles: IDS.map((id, i) => ({ id, title: TITLES[i] ?? 'Early Edition' })),
    root: IDS[0],
    login: LOGIN,
    kindle_base_url: 'http://192.168.1.50:8080',
    kindle_base_url_derived: false,
  })
})

// The server itself, the same for every child. Made up, but shaped like a Raspberry Pi in Docker.
const STARTED = Date.now() - (3 * 86400 + 4 * 3600 + 12 * 60) * 1000
app.get('/api/dashboard/about', (_req, res) => {
  const body: AboutView = {
    version: '0.2.0',
    arch: 'arm64',
    platform: 'linux',
    container: 'docker',
    uptime_seconds: Math.floor((Date.now() - STARTED) / 1000),
    // A morning fetch that worked, and a later try where one feed failed.
    sport: {
      updated_at: new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T06:01:00Z`)).toISOString(),
      attempted_at: new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T09:15:00Z`)).toISOString(),
      error: 'fixtures: HTTP 503',
    },
  }
  res.json(body)
})

// After the latency above, so the handlers below (all synchronous until they
// answer, bar regenerate) see this request's child.
app.use('/api/dashboard', (req: Request, res: Response, next: NextFunction) => {
  if (!useProfile(req.profile ?? IDS[0])) return fail(res, 404, 'That could not be found.')
  next()
})

// --- issues and stories -----------------------------------------------------
app.get('/api/dashboard/summary', (_req, res) => {
  const rec = db.issues.get(londonToday())
  const today = rec ? toIssueView(rec) : null
  const detail = streak()
  res.json({
    today,
    ...streakAndWeek(),
    streak: detail.current,
    last_run: db.runs[0] ?? null,
    streak_detail: detail,
    last_run_cost: today ? lastRunCost() : null,
    kindle_seen_at: today?.downloaded_by[0]?.received_at ?? null,
    catch_up_today: 0,
  })
})

// --- dashboard v2: reading, calendar, AI -------------------------------------
app.get('/api/dashboard/reading', (req, res) => {
  const days = Number(req.query.days ?? 14)
  if (!Number.isInteger(days) || days < 7 || days > 120) return fail(res, 400, 'days must be 7 to 120.')
  res.json(readingView(days))
})

app.get('/api/dashboard/calendar', (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : londonToday().slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail(res, 400, 'month must be YYYY-MM.')
  res.json(calendarView(month))
})

app.get('/api/dashboard/share', (_req, res) => {
  res.json(shareView())
})

app.get('/api/dashboard/ai', (_req, res) => {
  res.json(aiView())
})

app.put('/api/dashboard/ai', (req, res) => {
  const error = updateAi(req.body)
  if (error) return fail(res, 400, error)
  res.json(aiView())
})

app.get('/api/dashboard/issues', (req, res) => {
  const limit = Math.min(100, Number(req.query.limit ?? 30) || 30)
  const list = [...db.issues.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((rec) => {
      const v = toIssueView(rec)
      return {
        date: v.date,
        version: v.version,
        fallback: v.fallback,
        story_count: v.stories.filter((s) => !s.hidden).length,
        read_count: v.read_count,
      }
    })
  res.json(list)
})

app.get('/api/dashboard/issues/:date', (req, res) => {
  const rec = db.issues.get(req.params.date)
  if (!rec) return fail(res, 404, 'There is no issue for that date.')
  res.json(toIssueView(rec))
})

// The mock has no catching up: each paper is read on its own day.
app.get('/api/dashboard/day/:date', (req, res) => {
  const date = req.params.date
  const rec = db.issues.get(date)
  const paper = rec ? toIssueView(rec) : null
  const reads = (paper?.stories ?? [])
    .filter((s) => s.stats.opened)
    .map((s, i) => ({
      story: s,
      at: new Date(Date.parse(`${date}T07:30:00Z`) + i * 4 * 60_000).toISOString(),
      active_seconds: s.stats.active_seconds,
      finished: s.stats.reached_end,
    }))
  res.json({
    date,
    read: reads.filter((r) => r.finished).length,
    minutes: Math.round(reads.reduce((n, r) => n + r.active_seconds, 0) / 6) / 10,
    reads,
    paper,
    // Sport on days with reading: the table, a match and the results.
    sport: reads.length
      ? {
          date,
          views: 5,
          seconds: 395,
          pages: [
            { page: 'table', match_id: null, match: null, views: 2, seconds: 180 },
            { page: 'match', match_id: '2645301', match: 'Liverpool 4–0 Man Utd', views: 1, seconds: 130 },
            { page: 'matches', match_id: null, match: null, views: 2, seconds: 85 },
          ],
        }
      : null,
    sport_unlock: date === new Date().toISOString().slice(0, 10) ? sportToday() : null,
  })
})

app.get('/api/dashboard/stories/:id', (req, res) => {
  const s = db.stories.get(Number(req.params.id))
  if (!s) return fail(res, 404, 'That story does not exist.')
  res.json(toDetail(s))
})

for (const action of ['hide', 'unhide'] as const) {
  app.post(`/api/dashboard/stories/:id/${action}`, (req, res) => {
    const s = db.stories.get(Number(req.params.id))
    if (!s) return fail(res, 404, 'That story does not exist.')
    s.hidden = action === 'hide'
    res.json(toCard(s))
  })
}

app.post('/api/dashboard/regenerate', async (req, res) => {
  const today = londonToday()
  const rec = db.issues.get(today)
  if (rec && rec.downloaded_by.length > 0 && req.body?.confirm !== true) {
    return fail(
      res,
      409,
      'Today’s issue is already on the Kindle. Regenerating replaces it only while no story in it has been opened.',
    )
  }
  await sleep(2500)
  useProfile(req.profile ?? IDS[0]) // another child may have been asked for meanwhile
  const version = rec ? rec.version + 1 : 1
  const ids = []
  for (let p = 1; p <= 6; p++) ids.push(makeStory(today, version, p, version * 3 + p, 'none').id)
  db.issues.set(today, {
    date: today,
    version,
    fallback: false,
    created_at: new Date().toISOString(),
    downloaded_by: rec?.downloaded_by ?? [],
    storyIds: ids,
  })
  const now = new Date().toISOString()
  db.runs.unshift({
    started_at: new Date(Date.now() - 2500).toISOString(),
    finished_at: now,
    date: today,
    status: 'ok',
    detail: ['Forced run from the dashboard.', 'Picked 6 stories; all passed the checks.'],
  })
  res.json({ date: today, version, fallback: false, story_count: 6, status: 'created' })
})

app.get('/api/dashboard/runs', (req, res) => {
  const limit = Math.min(50, Number(req.query.limit ?? 10) || 10)
  res.json(db.runs.slice(0, limit))
})

// --- sport ---------------------------------------------------------------------
let sportSettings = { enabled: true, read_first: 0.5, min_reading: 0.5 }
const sportToday = () => {
  const rec = db.issues.get(new Date().toISOString().slice(0, 10))
  const stories = rec ? toIssueView(rec).stories.filter((s) => !s.hidden) : []
  if (!sportSettings.enabled || sportSettings.read_first <= 0 || !stories.length) return null
  const needed = Math.min(stories.length, Math.max(1, Math.ceil(stories.length * sportSettings.read_first)))
  const list = stories.map((s, i) => {
    const min = Math.ceil(s.stats.expected_seconds * sportSettings.min_reading)
    const finished = s.stats.reached_end
    // The second finished story is made a quick one, to show a story read too fast.
    const active = finished && i === 1 ? Math.min(s.stats.active_seconds, 9) : s.stats.active_seconds
    return { id: s.id, title: s.title, finished, active_seconds: active, min_seconds: min, counts: finished && active >= min, rushed: finished && active < min }
  })
  const counted = list.filter((x) => x.counts).length
  return { needed, total: list.length, counted, unlocked: counted >= needed, unlocked_at: counted >= needed ? new Date().toISOString() : null, stories: list }
}
app.get('/api/dashboard/sport/settings', (_req, res) => {
  res.json({ settings: sportSettings, today: sportToday() })
})
app.put('/api/dashboard/sport/settings', (req, res) => {
  const b = req.body ?? {}
  for (const k of ['read_first', 'min_reading'] as const) {
    if (k in b && (typeof b[k] !== 'number' || b[k] < 0 || b[k] > 1)) return fail(res, 400, 'Choose a value between 0 and 1.')
  }
  sportSettings = { ...sportSettings, ...b }
  res.json({ settings: sportSettings, today: sportToday() })
})
app.get('/api/dashboard/sport', (_req, res) => {
  const pages = [
    { page: 'table', match_id: null, match: null, views: 5, seconds: 410 },
    { page: 'match', match_id: '2645301', match: 'Liverpool 4–0 Man Utd', views: 3, seconds: 260 },
    { page: 'matches', match_id: null, match: null, views: 6, seconds: 190 },
    { page: 'next', match_id: null, match: null, views: 2, seconds: 45 },
  ]
  const to = new Date().toISOString().slice(0, 10)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(to) - (6 - i) * 86_400_000).toISOString().slice(0, 10)
    return { date: d, views: i % 2 ? 2 : 0, seconds: i % 2 ? 180 : 0, pages: [] }
  })
  res.json({ from: days[0].date, to, days, views: 16, seconds: 905, pages })
})

// --- topics -------------------------------------------------------------------
app.get('/api/dashboard/topics', (_req, res) => {
  res.json(topicViews())
})

app.post('/api/dashboard/topics/:name', (req, res) => {
  const name = req.params.name
  if (!TOPICS.some((t) => t.name === name)) return fail(res, 404, 'Unknown topic.')
  const mode = req.body?.mode
  if (mode !== null && mode !== 'pin' && mode !== 'block') return fail(res, 400, 'mode must be "pin", "block" or null.')
  if (mode) db.modes.set(name, mode)
  else db.modes.delete(name)
  res.json(topicViews().find((t) => t.name === name))
})

// --- articles and jobs ------------------------------------------------------
app.get('/api/dashboard/articles/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase()
  const used = new Set([...db.stories.values()].map((s) => s.source_url))
  const hits = ARCHIVE.filter((a) => !q || `${a.title} ${a.summary}`.toLowerCase().includes(q))
    .map((a) => ({ ...a, already_used: a.already_used || used.has(a.url) }))
    .slice(0, 30)
  res.json(hits)
})

app.post('/api/dashboard/articles/add', (req, res) => {
  const url = String(req.body?.url ?? '')
  const when = req.body?.when
  if (!/^https?:\/\//.test(url)) return fail(res, 400, 'That is not a web link.')
  if (when !== 'today' && when !== 'tomorrow') return fail(res, 400, 'when must be "today" or "tomorrow".')
  const hit = ARCHIVE.find((a) => a.url === url)
  const job: Job = { id: randomUUID(), status: 'pending', when, story: null, reasons: [] }
  jobs.set(job.id, { job, readyAt: Date.now() + JOB_MS, url, title: hit?.title ?? null, summary: hit?.summary ?? null, profile: req.profile ?? IDS[0] })
  res.status(202).json(job)
})

function guessTopic(text: string): string {
  const t = text.toLowerCase()
  if (/goal|cup|football|arsenal|ronaldo|messi|kane/.test(t)) return 'Football'
  if (/moon|sun|space|aurora|planet|nasa/.test(t)) return 'Space'
  if (/frog|tortoise|penguin|beaver|animal|bird/.test(t)) return 'Animals and nature'
  if (/robot|game|app|computer/.test(t)) return 'Games and tech'
  if (/storm|snow|rain|weather/.test(t)) return 'Weather'
  return 'Science'
}

function finishJob(entry: JobEntry) {
  const { job } = entry
  const reasons = failureReasons(entry.url)
  if (reasons) {
    job.status = 'failed'
    job.reasons = reasons
    return
  }
  const today = londonToday()
  const date = job.when === 'today' ? today : addDays(today, 1)
  const rec = job.when === 'today' ? db.issues.get(today) : undefined
  if (job.when === 'today' && !rec) {
    job.status = 'failed'
    job.reasons = ['There is no issue for today yet, so nothing can be added to it. Add it for tomorrow instead.']
    return
  }
  const base = TEMPLATES[templateFor(entry.url)]
  const template: Template = entry.title
    ? {
        ...base,
        topic: guessTopic(`${entry.title} ${entry.summary ?? ''}`),
        title: entry.title,
        teaser: entry.summary ?? base.teaser,
        source_url: entry.url,
        source_title: entry.title,
      }
    : { ...base, source_url: entry.url, source_title: null }
  const position = rec ? Math.max(0, ...issueStories(rec).map((s) => s.position)) + 1 : 1
  const story = makeStory(date, rec?.version ?? 1, position, template, 'none', {
    added_by_parent: true,
    source_url: entry.url,
    source_title: entry.title,
  })
  if (rec) rec.storyIds.push(story.id)
  job.status = 'done'
  job.story = toCard(story)
}

app.get('/api/dashboard/jobs/:id', (req, res) => {
  const entry = jobs.get(req.params.id)
  if (!entry || entry.profile !== (req.profile ?? IDS[0])) return fail(res, 404, 'Unknown job.')
  if (entry.job.status === 'pending' && Date.now() >= entry.readyAt) finishJob(entry)
  res.json(entry.job)
})

app.use('/api', (_req, res) => fail(res, 404, 'Not found.'))

// The real server's Kindle routes are not mocked; the dashboard never calls them.
app.get('/healthz', (_req, res) => {
  res.type('text').send('ok')
})

app.listen(PORT, () => {
  console.log(`Early Edition Kids mock API on http://localhost:${PORT}`)
})
