// Fake but realistic data for the mock dashboard API. Deterministic (seeded),
// so screenshots and tests look the same every run.
import type { ArticleHit, IssueView, RunView, StoryCard, StoryDetail, TopicView } from '../src/api/types.ts'

export const TOPICS: { name: string; base_weight: number }[] = [
  { name: 'Football', base_weight: 3 },
  { name: 'Science', base_weight: 3 },
  { name: 'Space', base_weight: 2 },
  { name: 'Animals and nature', base_weight: 2 },
  { name: 'Games and tech', base_weight: 1 },
  { name: 'Weather', base_weight: 1 },
  { name: 'Weird but true', base_weight: 1 },
]

export type Template = {
  topic: string
  title: string
  teaser: string
  paras: string[]
  word: [string, string] | null
  think: string
  source_name: string
  source_url: string
  source_title: string | null
}

const T = (
  topic: string,
  title: string,
  teaser: string,
  paras: string[],
  word: [string, string] | null,
  think: string,
  source_name: string,
  slug: string,
  source_title: string,
): Template => ({
  topic,
  title,
  teaser,
  paras,
  word,
  think,
  source_name,
  source_url: `https://www.bbc.co.uk/${source_name.includes('Sport') ? 'sport/football' : 'newsround'}/${slug}`,
  source_title,
})

export const TEMPLATES: Template[] = [
  T('Football', 'Harry Kane scores his 100th goal for Bayern Munich', 'He got there faster than any player in the club’s history.',
    ['England captain Harry Kane has scored his 100th goal for Bayern Munich, the German football club he joined two years ago.', 'He reached the number in fewer games than any Bayern player before him. That includes some of the most famous strikers in the world.', 'Kane scored with a header in the first half, then celebrated with his team-mates by holding up a shirt with “100” on the back.'],
    ['milestone', 'an important point or number that someone reaches'], 'Why do you think scoring goals quickly matters so much to a striker?',
    'BBC Sport', 'articles/kane-100', 'Kane reaches 100 Bayern goals in record time'),
  T('Science', 'Scientists grow tomatoes that last twice as long', 'A tiny change to one gene stops them going soft.',
    ['Scientists in Norwich have grown tomatoes that stay firm for twice as long as normal ones.', 'They changed one gene, a tiny instruction inside the plant, that tells the tomato when to go soft.', 'The team hopes it could mean less food is thrown away, because tomatoes would not go mushy so fast in the shop or at home.'],
    ['gene', 'a tiny instruction inside a living thing that helps decide how it grows'], 'What other foods would you like to last longer?',
    'BBC Newsround', 'tomatoes-last-longer', 'Gene-edited tomatoes last twice as long'),
  T('Space', 'A new moon has been spotted around Uranus', 'It is only about eight kilometres wide.',
    ['Astronomers using the James Webb Space Telescope have found a new moon going around the planet Uranus.', 'The moon is tiny, only about eight kilometres across. That is about the length of 80 football pitches in a row.', 'It brings the number of moons known to go around Uranus to 29.'],
    ['astronomer', 'a scientist who studies stars, planets and space'], 'Why do you think such a small moon was missed for so long?',
    'BBC Newsround', 'uranus-new-moon', 'Webb telescope finds tiny new moon of Uranus'),
  T('Animals and nature', 'Beavers build their first dam in London for 400 years', 'The family moved into a park in Ealing this spring.',
    ['A family of beavers has built a dam in a London park, the first in the city for about 400 years.', 'Beavers used to live all over Britain, but they were hunted until there were none left.', 'Experts say the dam helps other wildlife, because it makes ponds where frogs, insects and birds can live.'],
    ['dam', 'a wall built across a river or stream to hold water back'], 'How do you think the other animals in the park feel about their new neighbours?',
    'BBC Newsround', 'london-beavers-dam', 'Beavers build first London dam in 400 years'),
  T('Games and tech', 'A robot learns to tie shoelaces', 'It took the robot 1,000 tries to get it right.',
    ['Engineers in California have taught a robot with two arms to tie a pair of shoelaces.', 'It sounds simple, but laces are floppy and hard to grip, which makes them tricky for robots.', 'The robot practised about 1,000 times before it could tie a neat bow by itself.'],
    ['engineer', 'a person who designs and builds machines'], 'What job at home would you most like a robot to do?',
    'BBC Newsround', 'robot-shoelaces', 'Robot masters shoelace tying'),
  T('Weather', 'Snow is on the way for parts of Scotland', 'Some hills could get 10 centimetres by Saturday.',
    ['Forecasters say snow could fall on high ground in Scotland this weekend.', 'Some hills might get up to 10 centimetres, which is about as deep as a pencil is long.', 'Most towns are likely to get rain instead, but it will feel much colder everywhere.'],
    ['forecaster', 'a person who works out what the weather is going to do'], 'What is the first thing you would do if it snowed tomorrow?',
    'BBC Newsround', 'scotland-snow', 'Snow forecast for Scottish hills'),
  T('Weird but true', 'A pumpkin as heavy as a small car', 'It weighed more than 1,200 kilograms.',
    ['A farmer in Minnesota, in America, has grown a pumpkin that weighs more than 1,200 kilograms.', 'That is about as heavy as a small car. It had to be lifted with a special machine.', 'The farmer fed it lots of water every day and kept it warm with blankets on cold nights.'],
    null, 'How would you move a pumpkin that heavy without a machine?',
    'BBC Newsround', 'giant-pumpkin', 'Record-breaking pumpkin weighs 1.2 tonnes'),
  T('Football', 'Lionel Messi wins another award at 39', 'He was named player of the season in America.',
    ['Lionel Messi has been named the best player of the season in America’s football league, Major League Soccer.', 'Messi is 39 years old, which is older than most professional footballers when they stop playing.', 'He scored 26 goals for his team, Inter Miami, this season.'],
    ['professional', 'someone who is paid to do something as their job'], 'Why do you think Messi still plays so well at 39?',
    'BBC Sport', 'articles/messi-mls-award', 'Messi named MLS player of the season'),
  T('Science', 'Why your fingers go wrinkly in the bath', 'It may help you grip things when they are wet.',
    ['Scientists think they know why our fingers go wrinkly after a long bath.', 'In tests, people with wrinkly fingers were better at picking up wet marbles than people with smooth fingers.', 'The wrinkles work a bit like the tread on a tyre, letting water drain away so you can grip.'],
    ['grip', 'to hold something tightly'], 'Can you think of something else that has grooves to help it grip?',
    'BBC Newsround', 'wrinkly-fingers', 'The science of wrinkly fingers'),
  T('Space', 'Astronauts grow lettuce on the space station', 'They ate some of it for lunch.',
    ['Astronauts on the International Space Station have grown lettuce in a special box with pink lights.', 'Plants need light to grow, and the lights give them exactly the colours they need.', 'Growing food in space could help people go on very long trips, like a journey to Mars one day.'],
    ['orbit', 'the path something takes as it goes around a planet or star'], 'What food would you want to grow if you lived in space?',
    'BBC Newsround', 'space-lettuce', 'Space station crew grow lettuce'),
  T('Animals and nature', 'Puffins are back on the Farne Islands', 'Rangers counted more than 40,000 pairs.',
    ['Rangers have counted more than 40,000 pairs of puffins on the Farne Islands, off the coast of Northumberland.', 'Puffins spend most of the year out at sea and only come to land to lay eggs.', 'The number is higher than last year, which rangers say is good news.'],
    ['ranger', 'a person whose job is to look after a park or nature area'], 'Why do you think puffins only come to land to lay eggs?',
    'BBC Newsround', 'farne-puffins', 'Puffin numbers rise on Farne Islands'),
  T('Games and tech', 'A new game lets you design your own football stadium', 'Players can build stands, roofs and even a moat.',
    ['A new video game lets players design their own football stadium, from the pitch to the roof.', 'You can choose how many seats there are, what colour they are, and where the fans go.', 'The makers say some players have built stadiums shaped like castles and spaceships.'],
    ['design', 'to plan how something will look and work'], 'What would your dream stadium look like?',
    'BBC Newsround', 'stadium-game', 'Build-your-own stadium game released'),
]

// --- seeded random ----------------------------------------------------------
let seed = 42
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

// --- dates ------------------------------------------------------------------
export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(now)
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** An ISO timestamp for a London wall-clock time (good enough for a mock: treats London as UTC). */
export function at(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00Z`).toISOString()
}

// --- the store --------------------------------------------------------------
export type Stored = StoryDetail & { template: number }
export type IssueRec = Omit<IssueView, 'stories' | 'read_count'> & { storyIds: number[] }

function emptyDb() {
  return {
    nextId: 1001,
    stories: new Map<number, Stored>(),
    issues: new Map<string, IssueRec>(), // latest version per date
    modes: new Map<string, 'pin' | 'block'>(),
    runs: [] as RunView[],
  }
}

/** The current profile's store. A live binding: useProfile() swaps it for another child's. */
export let db = emptyDb()
const dbs = new Map<string, ReturnType<typeof emptyDb>>()

/** Seed a store for each profile (MOCK_PROFILES); the first is current afterwards. */
export function seedProfiles(ids: string[], opts: { noIssueToday: boolean }) {
  ids.forEach((id, i) => {
    db = emptyDb()
    dbs.set(id, db)
    seedData({ ...opts, shift: i * 3 }) // each child reads on different days
  })
  db = dbs.get(ids[0])!
}

/** Make a profile's store current. Returns false for an unknown id. */
export function useProfile(id: string): boolean {
  const next = dbs.get(id)
  if (!next) return false
  db = next
  return true
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

function bodyHtml(t: Template, minutes: number): string {
  const parts = [
    `<p class="kicker">${escapeHtml(t.topic.toUpperCase())} · ${minutes} MINUTE READ</p>`,
    `<h1>${escapeHtml(t.title)}</h1>`,
    ...t.paras.map((p) => `<p>${escapeHtml(p)}</p>`),
  ]
  if (t.word) {
    parts.push(
      `<div class="box"><p class="label">WORD TO KNOW</p><p><b>${escapeHtml(t.word[0][0].toUpperCase() + t.word[0].slice(1))}</b>: ${escapeHtml(t.word[1])}</p></div>`,
    )
  }
  parts.push(`<div class="box"><p class="label">THINK ABOUT IT</p><p>${escapeHtml(t.think)}</p></div>`)
  parts.push(`<p class="source">Source: ${escapeHtml(t.source_name)}</p>`)
  return parts.join('\n')
}

export type StatsKind = 'none' | 'opened' | 'finished' | 'engaged'

export function makeStory(
  date: string,
  version: number,
  position: number,
  templateIndex: number | Template,
  stats: StatsKind,
  extra: Partial<StoryCard> = {},
): Stored {
  const t = typeof templateIndex === "number" ? TEMPLATES[templateIndex % TEMPLATES.length] : templateIndex
  const word_count = 110 + Math.round(rand() * 90)
  const minutes = Math.max(1, Math.round(word_count / 90))
  const expected = Math.round((word_count / 90) * 60)
  const active =
    stats === 'none' ? 0 : stats === 'opened' ? Math.round(expected * 0.3) : stats === 'finished' ? Math.round(expected * 0.35) : Math.round(expected * (0.8 + rand() * 0.6))
  const id = db.nextId++
  const s: Stored = {
    id,
    date,
    version,
    position,
    topic: t.topic,
    title: t.title,
    teaser: t.teaser,
    minutes,
    word_count,
    hidden: false,
    added_by_parent: false,
    reused: false,
    source_name: t.source_name,
    source_url: t.source_url,
    source_title: t.source_title,
    stats: {
      opened: stats !== 'none',
      reached_end: stats === 'finished' || stats === 'engaged',
      active_seconds: active,
      expected_seconds: expected,
      engaged: stats === 'engaged',
      read_on: stats === 'finished' || stats === 'engaged' ? date : null,
    },
    body_html: bodyHtml(t, minutes),
    word_to_know: t.word ? { word: t.word[0], definition: t.word[1] } : null,
    think_about_it: t.think,
    prev_id: null,
    next_id: null,
    image: null,
    template: typeof templateIndex === "number" ? templateIndex : -1,
    ...extra,
  }
  db.stories.set(id, s)
  return s
}

export function issueStories(rec: IssueRec): Stored[] {
  return rec.storyIds.map((id) => db.stories.get(id)!).sort((a, b) => a.position - b.position)
}

export function toCard(s: Stored): StoryCard {
  return {
    id: s.id,
    date: s.date,
    version: s.version,
    position: s.position,
    topic: s.topic,
    title: s.title,
    teaser: s.teaser,
    minutes: s.minutes,
    word_count: s.word_count,
    hidden: s.hidden,
    added_by_parent: s.added_by_parent,
    reused: s.reused,
    source_name: s.source_name,
    source_url: s.source_url,
    source_title: s.source_title,
    stats: { ...s.stats },
  }
}

export function toDetail(s: Stored): StoryDetail {
  const detail: StoryDetail = {
    ...toCard(s),
    body_html: s.body_html,
    word_to_know: s.word_to_know,
    think_about_it: s.think_about_it,
    prev_id: null,
    next_id: null,
    image: null,
  }
  const rec = db.issues.get(s.date)
  if (rec && rec.version === s.version) {
    const list = issueStories(rec)
    const i = list.findIndex((x) => x.id === s.id)
    detail.prev_id = i > 0 ? list[i - 1].id : null
    detail.next_id = i >= 0 && i < list.length - 1 ? list[i + 1].id : null
  }
  return detail
}

export function toIssueView(rec: IssueRec): IssueView {
  const stories = issueStories(rec)
  return {
    date: rec.date,
    version: rec.version,
    fallback: rec.fallback,
    created_at: rec.created_at,
    downloaded_by: rec.downloaded_by,
    read_count: stories.filter((s) => !s.hidden && s.stats.reached_end).length,
    stories: stories.map(toCard),
  }
}

function pattern(dayOffset: number): StatsKind[] {
  // Every 11th day (and a few others) he did not read; otherwise 2 to 6 stories.
  if (dayOffset % 11 === 4 || dayOffset === 47 || dayOffset === 48) return ['none', 'none', 'none', 'none', 'none', 'none']
  const all: StatsKind[][] = [
    ['engaged', 'engaged', 'finished', 'opened', 'none', 'none'],
    ['engaged', 'finished', 'engaged', 'engaged', 'engaged', 'engaged'],
    ['engaged', 'engaged', 'engaged', 'engaged', 'opened', 'none'],
    ['engaged', 'finished', 'engaged', 'opened', 'engaged', 'none'],
    ['engaged', 'opened', 'engaged', 'finished', 'engaged', 'none'],
    ['finished', 'engaged', 'none', 'opened', 'none', 'none'],
    ['engaged', 'engaged', 'engaged', 'engaged', 'engaged', 'engaged'],
  ]
  return all[dayOffset % all.length]
}

/** Days of history the mock keeps (enough for "12 weeks" and earlier calendar months). */
export const HISTORY_DAYS = 120

export function seedData(opts: { noIssueToday: boolean; shift?: number }) {
  const shift = opts.shift ?? 0
  const today = londonToday()
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const date = addDays(today, -back)
    if (back === 0 && opts.noIssueToday) continue
    if (back === 61) continue // a day with no paper at all
    const fallback = back === 5
    const kinds: StatsKind[] =
      back === 0 ? ['engaged', 'finished', 'opened', 'none', 'none', 'none'] : pattern(back + shift)
    const ids: number[] = []
    for (let p = 1; p <= 6; p++) {
      const s = makeStory(date, 1, p, back * 5 + p, kinds[p - 1], {
        reused: fallback,
        added_by_parent: back === 2 && p === 6,
        hidden: (back === 0 && p === 4) || (back === 7 && p === 2),
      })
      ids.push(s.id)
    }
    db.issues.set(date, {
      date,
      version: 1,
      fallback,
      created_at: at(date, '05:33'),
      downloaded_by: [{ device: 'b5c1e2a0', version: 1, received_at: at(date, back % 2 ? '07:02' : '06:41') }],
      storyIds: ids,
    })
  }

  for (let back = 0; back < 10; back++) {
    const date = addDays(today, -back)
    if (back === 0 && opts.noIssueToday) {
      db.runs.push({
        started_at: at(date, '05:30'),
        finished_at: at(date, '05:31'),
        date,
        status: 'failed',
        detail: ['Could not reach the writer model (timed out after 60 s).', 'Only 2 unopened stories from the last week, so no catch-up issue was published.'],
      })
      continue
    }
    db.runs.push(
      back === 5
        ? {
            started_at: at(date, '05:30'),
            finished_at: at(date, '05:32'),
            date,
            status: 'fallback',
            detail: ['The writer model returned errors for 4 of 6 stories.', 'Published a catch-up issue from 6 unopened stories from this week.'],
          }
        : {
            started_at: at(date, '05:30'),
            finished_at: at(date, '05:33'),
            date,
            status: 'ok',
            detail: [
              '47 feed items fetched, 31 left after filters and de-duplication.',
              'Picked 6: Football 2, Science 1, Space 1, Animals and nature 1, Weird but true 1.',
              'All 6 stories passed the number check and the checker.',
            ],
          },
    )
  }
}

export function topicViews(): TopicView[] {
  const since = addDays(londonToday(), -13)
  return TOPICS.map(({ name, base_weight }) => {
    let shown = 0
    let opened = 0
    let engaged = 0
    for (const rec of db.issues.values()) {
      if (rec.date < since || rec.downloaded_by.length === 0) continue
      for (const s of issueStories(rec)) {
        if (s.topic !== name || s.hidden) continue
        shown++
        if (s.stats.opened) opened++
        if (s.stats.engaged) engaged++
      }
    }
    const engagement_rate = (engaged + 1) / (shown + 2)
    const mode = db.modes.get(name) ?? null
    const maths = base_weight * (0.5 + engagement_rate)
    return {
      name,
      base_weight,
      effective_weight: Math.round((mode === 'block' ? 0 : mode === 'pin' ? Math.max(maths, base_weight * 1.5) : maths) * 10) / 10,
      mode,
      shown,
      opened,
      engaged,
      open_rate: shown ? opened / shown : 0,
      engagement_rate,
    }
  })
}

export function streakAndWeek(): { streak: number; week_read: number } {
  const today = londonToday()
  const engagedOn = (date: string) => {
    const rec = db.issues.get(date)
    return rec ? issueStories(rec).some((s) => s.stats.engaged) : false
  }
  let streak = 0
  let d = engagedOn(today) ? today : addDays(today, -1)
  while (engagedOn(d)) {
    streak++
    d = addDays(d, -1)
  }
  // Week starts on Monday.
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(today, -dow)
  let week_read = 0
  for (const rec of db.issues.values()) {
    if (rec.date < monday) continue
    week_read += issueStories(rec).filter((s) => s.stats.reached_end).length
  }
  return { streak, week_read }
}

export const ARCHIVE: ArticleHit[] = [
  ['BBC Newsround', 'Storm Bert: homes flooded as rivers burst their banks', 'Hundreds of homes were flooded across Wales and the north of England after heavy rain.', false, 'storm-bert-floods'],
  ['BBC Sport', 'Liverpool reach the League Cup quarter-finals', 'A late header from Virgil van Dijk sent Liverpool through at Anfield.', false, 'liverpool-league-cup'],
  ['BBC Newsround', 'Scientists find a frog that glows under blue light', 'The tiny frog lives in the Brazilian rainforest and was only discovered this year.', false, 'glowing-frog'],
  ['NASA', 'Northern lights could be seen across the UK tonight', 'A burst of energy from the Sun means the aurora may be visible as far south as Cornwall.', false, 'aurora-uk'],
  ['BBC Newsround', 'Harry Kane scores his 100th goal for Bayern Munich', 'He got there faster than any player in the club’s history.', true, 'kane-100'],
  ['BBC Science', 'A robot dog helps scientists study volcanoes', 'The four-legged robot can walk into places that are too hot or dangerous for people.', false, 'robot-dog-volcano'],
  ['BBC Newsround', 'The UK’s oldest tortoise turns 120', 'Jonathan’s younger cousin, Gerald, celebrated with a cake made of lettuce.', false, 'oldest-tortoise'],
  ['BBC Sport', 'Cristiano Ronaldo scores an overhead kick at 41', 'Fans said it was one of the best goals of his career.', false, 'ronaldo-overhead'],
  ['BBC Newsround', 'Penguins at Edinburgh Zoo get Christmas jumpers', 'The jumpers were knitted by volunteers to raise money for a penguin charity.', false, 'penguin-jumpers'],
  ['BBC Science', 'A new way to recycle old trainers', 'Engineers have found a way to grind up old shoes and turn them into running tracks.', false, 'recycle-trainers'],
  ['BBC Newsround', 'Beavers build their first dam in London for 400 years', 'The family moved into a park in Ealing this spring.', true, 'london-beavers-dam'],
  ['BBC Science', 'The Moon is slowly moving away from Earth', 'It drifts about four centimetres further away every year.', false, 'moon-drift'],
].map(([source_name, title, summary, already_used, slug], i) => ({
  url: `https://www.bbc.co.uk/news/${slug as string}`,
  source_name: source_name as string,
  title: title as string,
  summary: summary as string,
  published_at: new Date(Date.now() - (i * 9 + 3) * 3600 * 1000).toISOString(),
  already_used: already_used as boolean,
}))

/** Adding these fails the checks, with reasons. */
export function failureReasons(url: string): string[] | null {
  if (url.includes('storm-bert') || url.includes('fail')) {
    return [
      'The checker found it could upset an 8 year old: it describes families losing their homes.',
      'Two numbers in the rewrite were not in the original article.',
    ]
  }
  return null
}

export function templateFor(url: string): number {
  const i = ARCHIVE.findIndex((a) => a.url === url)
  return i >= 0 ? (i * 7) % TEMPLATES.length : Math.floor(rand() * TEMPLATES.length)
}
