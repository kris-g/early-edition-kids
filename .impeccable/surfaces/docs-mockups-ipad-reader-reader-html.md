---
version: 1
slug: "docs-mockups-ipad-reader-reader-html"
primary_target: "docs/mockups/ipad-reader/reader.html"
related_targets: []
---

# iPad reader (child-facing paper)

Scope: the child's reader as an iPad home-screen web app: front page, story, end of story. Mode: Read. Prototype at `docs/mockups/ipad-reader/`.

Audience and job: a child of any profile age reads today's six stories alone, iPad held either way up. Sizes follow the profile's age. Reading mode (pages or scrolling) is a setting.

Constraints: no links out and no route to the parent dashboard; every layout holds for a story with no photo; counts and a streak only, never a score.

Decided by the user on 15 November 2026: no persistent strip of story icons. Stories are chosen from the front page only; a story carries a running head (Front page, the title, Story n of 6) and hands on to the next story at its end.

Unresolved: where the reading-mode setting lives (profile config assumed); Back issues and My week screens; dark appearance; where article photos come from and how they are credited. Not carried over from the Kindle front page yet: Word of the day, Check for news (and the no-paper-yet state), and the Sources line.

## Direction contract

THESIS: The iPad paper is the Kindle's Early Edition printed in colour: a finite daily paper with a front page and six stories. It refuses the children's-app arrangement of rounded cards, mascots and reward chrome, and the endless feed.

OWN-WORLD: Newsprint white ground, near-black ink, sunrise yellow for the mark and the reader's current place. One flat section colour per topic, used as whole fields: the flag on a photo, the Word to know box, the opener of a story with no photo. Playfair Display Black masthead, Noto Serif headlines and body, Noto Sans labels. Ink rules, square corners, the Kindle's topic icons and round Read stamp.

STORY: The child sees today's paper, starts the lead or picks another from the front page, reads to the end, earns the stamp, and is handed the next story. The paper ends.

FIRST VIEWPORT: Dateline and masthead across the top. Lead photo with its section flag, headline near 50px, Start reading. The other five stories as rows with thumbnails and a read count. Nothing fixed to the screen edge.

FORM: Turn the pages, position 3 of 7 on the ordered list, with One long paper (position 6) as the scrolling mode of the same frame, because the user asked to support both through a setting. Signature interaction: the page turn, and the Read stamp landing when a story is finished. seed:623d5d8da5a91a0b

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
