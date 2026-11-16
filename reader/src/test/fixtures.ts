import type { Issue } from '../types'

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
