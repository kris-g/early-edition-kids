import type { Issue, SportsView } from '../types'

/** The story page the server writes (server/templates/story.njk), for one story. */
export const STORY_HTML = `<!DOCTYPE html>
<html lang="en-GB"><head><meta charset="utf-8"><title>Space · Rocket</title><style>p{}</style></head>
<body>
<p class="kicker">SPACE · 2 MINUTE READ</p>
<h1>SpaceX tries to catch a whole rocket</h1>
<p>Imagine catching something as tall as a tower block.</p>
<p>The bottom part, called the <b>booster</b>, flies back down &amp; lands.</p>
<p><script>alert(1)</script>It is <a href="https://example.com">cheaper</a> <img src=x onerror="alert(1)">that way.</p>
<div class="box">
<p class="label">WORD TO KNOW</p>
<p><b>Booster</b>: the part of a rocket that pushes it off the ground.</p>
</div>
<div class="box">
<p class="label">THINK ABOUT IT</p>
<p>What would you send into space?</p>
</div>
<p class="source">Source: BBC Newsround</p>
</body>
</html>`

export function issue(over: Partial<Issue> = {}): Issue {
  const topics = ['Football', 'Science', 'Space', 'Animals and nature']
  return {
    date: '2026-11-16',
    version: 1,
    fallback: false,
    title: 'Early Edition',
    number: 7,
    created_at: '2026-11-16T05:31:07+00:00',
    stories: topics.map((topic, i) => ({
      id: 40 + i,
      position: i + 1,
      topic,
      title: `Story <${i + 1}>`,
      teaser: `Teaser ${i + 1}`,
      minutes: 2,
      path: `/issues/2026-11-16/v1/${i + 1}.html`,
      word_to_know: { word: 'booster', definition: 'the part of a rocket that pushes it' },
      image: i === 2 ? null : { path: `/issues/2026-11-16/v1/${i + 1}.jpg`, alt: `Alt ${i + 1}` },
    })),
    hidden: [],
    reading_since: null,
    profile: 'older',
    profile_root: true,
    ...over,
  }
}

/** A small Sport page: two days of a round (one result with its detail, one still to play), the next round and a short table. */
export function sportsView(over: Partial<SportsView> = {}): SportsView {
  return {
    competition: 'Premier League',
    updated_at: '2026-11-16T05:30:00.000Z',
    results_to: '2026-11-15',
    favourite_team: 'liverpool',
    teams: [
      { id: 'liverpool', name: 'Liverpool', short: 'Liverpool' },
      { id: 'man-utd', name: 'Manchester United', short: 'Man Utd' },
      { id: 'brentford', name: 'Brentford', short: 'Brentford' },
      { id: 'everton', name: 'Everton', short: 'Everton' },
    ],
    matchday: {
      number: 11,
      days: [
        {
          date: '2026-11-15',
          matches: [
            {
              id: '2645301',
              kickoff: '2026-11-15T16:30:00Z',
              home: 'liverpool',
              away: 'man-utd',
              state: 'finished',
              score: { home: 2, away: 0 },
              goals: [
                { side: 'home', player: 'Szoboszlai', minute: "10'", kind: 'goal' },
                { side: 'home', player: 'Wirtz', minute: "13'", kind: 'penalty' },
              ],
              detail: {
                goals: [
                  { side: 'home', player: 'Dominik Szoboszlai', minute: "10'", kind: 'goal' },
                  { side: 'home', player: 'Florian Wirtz', minute: "13'", kind: 'penalty' },
                ],
                penalties: [],
                cards: [{ side: 'away', player: 'Leny <Yoro>', minute: "8'", card: 'red' }],
                lineups: {
                  home: { starting: [{ line: 'goalkeeper', players: [{ name: 'Alisson Becker', number: '1', on: null, off: null }] }], bench: [{ name: 'Joe Gomez', number: '2', on: "85'", off: null }] },
                  away: { starting: [{ line: 'goalkeeper', players: [{ name: 'Senne Lammens', number: '1', on: null, off: null }] }], bench: [] },
                },
                subs: [{ side: 'home', minute: "85'", on: 'Joe Gomez', off: 'Ronald Araujo', injury: true }],
                out_injured: { home: ['Bradley'], away: [] },
              },
            },
          ],
        },
        {
          date: '2026-11-16',
          matches: [{ id: '2645297', kickoff: '2026-11-16T20:00:00Z', home: 'brentford', away: 'everton', state: 'scheduled', score: null, goals: [], detail: null }],
        },
      ],
    },
    next: {
      number: 12,
      days: [{ date: '2026-11-22', matches: [{ id: '2645310', kickoff: '2026-11-22T12:00:00Z', home: 'everton', away: 'liverpool', state: 'scheduled', score: null, goals: [], detail: null }] }],
    },
    table: {
      final: false,
      rows: [
        { position: 1, team: 'liverpool', played: 11, won: 8, drawn: 2, lost: 1, goal_difference: 14, points: 26 },
        { position: 2, team: 'brentford', played: 11, won: 6, drawn: 2, lost: 3, goal_difference: 3, points: 20 },
        { position: 3, team: 'man-utd', played: 11, won: 1, drawn: 5, lost: 5, goal_difference: -9, points: 8 },
      ],
      lines: [{ after: 1, label: 'Champions League' }],
    },
    unlock: null,
    ...over,
  }
}
