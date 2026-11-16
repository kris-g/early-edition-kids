import type { AiPage } from '../api/routes'
import type { ReadingView, ShareView } from '../api/types'
import type { Job, StoryCard, StoryChecks, StoryDetail, StoryStats } from '../api/types'

export function stats(over: Partial<StoryStats> = {}): StoryStats {
  return { opened: false, reached_end: false, active_seconds: 0, expected_seconds: 90, engaged: false, read_on: null, ...over }
}

export function card(over: Partial<StoryCard> = {}): StoryCard {
  return {
    id: 41,
    date: '2026-11-13',
    version: 1,
    position: 1,
    topic: 'Football',
    title: 'Harry Kane wins the Ballon d’Or',
    teaser: 'The first English winner for 25 years.',
    minutes: 2,
    word_count: 160,
    hidden: false,
    added_by_parent: false,
    reused: false,
    source_name: 'BBC Sport',
    source_url: 'https://www.bbc.co.uk/sport/football/1',
    source_title: null,
    stats: stats(),
    ...over,
  }
}

/** A passing story's checks: both of the story's figures are in its source. */
export function checks(over: Partial<StoryChecks> = {}): StoryChecks {
  return {
    numbers: [
      { value: '25', in_source: true },
      { value: '61', in_source: true },
    ],
    verdict: { safe: true, supported: true, reasons: [] },
    attempts: 1,
    writer_model: 'anthropic:claude-opus-5-5',
    checker_model: 'anthropic:claude-opus-5-5',
    ...over,
  }
}

/** A story as GET /stories/:id returns it, with marks on its checked numbers and its word to know. */
export function detail(over: Partial<StoryDetail> = {}): StoryDetail {
  return {
    ...card(),
    body_html:
      '<p class="kicker">FOOTBALL · 2 MINUTE READ</p>\n<h1>Harry Kane wins the Ballon d’Or</h1>\n' +
      '<p>He is the first English winner for <mark data-check="number" data-value="25">25</mark> years.</p>\n' +
      '<p>Kane scored <mark data-check="number" data-value="61">61</mark> times and got his prize at a big ' +
      '<mark data-check="word"><b>ceremony</b></mark> in London.</p>\n' +
      '<div class="box"><p class="label">WORD TO KNOW</p><p><b>Ceremony</b>: a special event held to celebrate something.</p></div>',
    word_to_know: { word: 'ceremony', definition: 'a special event held to celebrate something.' },
    think_about_it: 'Who do you think should win next year?',
    prev_id: null,
    next_id: null,
    image: null,
    checks: checks(),
    created_at: '2026-11-13T05:31:07+00:00',
    ...over,
  }
}

export function job(over: Partial<Job> = {}): Job {
  return { id: 'j1', status: 'pending', when: 'today', story: null, reasons: [], ...over }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}


export function readingView(days: number, to = '2026-11-13'): ReadingView {
  const end = new Date(`${to}T12:00:00Z`)
  const list = Array.from({ length: days }, (_, i) => {
    const d = new Date(end)
    d.setUTCDate(end.getUTCDate() - (days - 1 - i))
    const read = i % 7 === 3 ? 0 : (i % 6) + 1
    return { date: d.toISOString().slice(0, 10), issue: true, stories: 6, read, minutes: read * 1.8 }
  })
  const total = list.reduce((a, d) => a + d.read, 0)
  return {
    from: list[0].date,
    to,
    days: list,
    streak: { current: 3, current_since: list[days - 3].date, longest: 9, longest_from: '2026-10-01', longest_to: '2026-10-09' },
    reading_days: list.filter((d) => d.read > 0).length,
    total_read: total,
    avg_read_per_day: total / days,
    avg_minutes_per_day: (total * 1.8) / days,
    topics: [
      { name: 'Football', read: 5, shown: 7 },
      { name: 'Space', read: 2, shown: 4 },
    ],
  }
}

export function aiPage(): AiPage {
  return {
    settings: {
      provider: 'anthropic',
      writer_model: 'anthropic:claude-opus-5-5',
      check_model: 'anthropic:claude-opus-5-5',
      writer_effort: 'high',
      check_effort: 'high',
      monthly_limit_usd: 25,
    },
    models: [
      { id: 'anthropic:claude-opus-5-5', provider: 'anthropic', name: 'Claude Opus 5.5', note: 'Careful.', input_per_mtok: 4, output_per_mtok: 20, est_day_writer_usd: 0.34, est_day_checker_usd: 0.12 },
      { id: 'anthropic:claude-sonnet-5-5', provider: 'anthropic', name: 'Claude Sonnet 5.5', note: 'Half the cost.', input_per_mtok: 2, output_per_mtok: 10, est_day_writer_usd: 0.17, est_day_checker_usd: 0.06 },
      { id: 'anthropic:claude-haiku-5-5', provider: 'anthropic', name: 'Claude Haiku 5.5', note: 'Cheapest.', input_per_mtok: 0.1, output_per_mtok: 0.5, est_day_writer_usd: 0.01, est_day_checker_usd: 0.003 },
    ],
    providers: [
      { id: 'anthropic', name: 'Anthropic API', configured: true, last_used: '2026-11-13T05:31:00Z' },
      { id: 'openrouter', name: 'OpenRouter', configured: false, last_used: null },
    ],
    last_run: {
      run_id: 1, date: '2026-11-13', started_at: '2026-11-13T05:31:00Z', seconds: 61, status: 'ok', calls: 15,
      cost_usd: 0.46, input_tokens: 50500, output_tokens: 13100, sent_back: 1, refused: 0,
      models: ['anthropic:claude-opus-5-5'],
      stages: [
        { stage: 'select', calls: 1, cost_usd: 0.04 },
        { stage: 'rewrite', calls: 7, cost_usd: 0.3 },
        { stage: 'check', calls: 7, cost_usd: 0.12 },
      ],
    },
    month: {
      month: '2026-11', cost_usd: 6.17, limit_usd: 25, projected_usd: 14.2,
      days: [
        { date: '2026-11-12', cost_usd: 0.47 },
        { date: '2026-11-13', cost_usd: 0.46 },
      ],
    },
    quality: { sent_back: 3, refused: 0, on_time: 13, issues: 13, avg_seconds: 58 },
    provider_last_used: '2026-11-13T05:31:00Z',
  }
}

/** Share cards for Saturday 14 November: a 4-day streak since Wednesday with Tuesday 10 missed. */
export function shareView(over: Partial<ShareView> = {}): ShareView {
  const today = '2026-11-14'
  const fortnight = readingView(14, today).days.map((d) => ({
    ...d,
    read: d.date === '2026-11-10' ? 0 : Math.max(1, d.read),
  }))
  const week = fortnight.slice(-7)
  const s = (id: number, topic: string, title: string) => ({ id, topic, title, teaser: '' })
  return {
    today,
    streak: { current: 4, current_since: '2026-11-11', longest: 10, longest_from: '2026-07-24', longest_to: '2026-08-02' },
    fortnight,
    today_read: {
      stories: [
        s(1, 'Football', 'Harry Kane wins the Ballon d’Or'),
        s(2, 'Liverpool FC', 'Salah scores twice in big Egypt win'),
        s(3, 'Animals and nature', 'Jojo the lonely gorilla needs a friend'),
      ],
      minutes: 8.6,
      in_paper: 8,
    },
    week: {
      from: week[0].date,
      to: today,
      days: week,
      total_read: week.reduce((a, d) => a + d.read, 0),
      minutes: 41.2,
      reading_days: 6,
      top_topics: ['Football', 'Science', 'Space'],
    },
    total_read: 53,
    milestone: { stories: 50, date: today, story: s(1, 'Football', 'Harry Kane wins the Ballon d’Or'), next: 75 },
    words: [
      { word: 'record', definition: 'The best anyone has ever done.', story_title: 'Harry Kane breaks England record' },
      { word: 'companion', definition: 'Someone who keeps you company.', story_title: 'Jojo the lonely gorilla needs a friend' },
    ],
    ask: { date: today, stories: [s(1, 'Football', 'Harry Kane wins the Ballon d’Or'), s(3, 'Animals and nature', 'Jojo the lonely gorilla needs a friend')] },
    ...over,
  }
}
