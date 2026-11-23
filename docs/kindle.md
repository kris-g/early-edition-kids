# The Kindle screens

What the child sees in KOReader. The plugin draws the front page, the headline list, the finished panel and back issues itself; stories open in KOReader's normal reader.

These are captures from the KOReader emulator at the Kindle Paperwhite's size. E-ink refresh, fonts and touch can only be judged on the real device.

<img src="images/kindle/set-paper.png" alt="The paper on a Kindle Paperwhite 3: front page, today's paper, end of a story and back issues">

The feature sets (this one and Sport's, below) are made by [`tools/kindle-sets.mjs`](tools/kindle-sets.mjs) from the plugin's screenshot tour run on the sample papers; the script's header says how.

| Front page | Today's paper | A story | End of a story | Back issues |
|:---:|:---:|:---:|:---:|:---:|
| <img src="images/kindle/front-page.png" width="160" alt="Front page"> | <img src="images/kindle/todays-paper.png" width="160" alt="Today's paper"> | <img src="images/kindle/story-page.png" width="160" alt="A story with its photo"> | <img src="images/kindle/story-finished.png" width="160" alt="End of a story"> | <img src="images/kindle/back-issues.png" width="160" alt="Back issues"> |

## Front page

<img src="images/kindle/front-page.png" width="360" alt="The Early Edition front page, with the First up story's photo beside its headline">

- **Masthead:** the date, the issue number and the title.
- **Today's paper:** how many stories and minutes, how many are read, a topic icon per story, and the first unread story with **Start reading**. When that story has a photo, it sits beside the headline instead of the teaser, and tapping either opens the story.
- **Back issues** and **My week** open their own screens.
- **Word of the day** comes from one of today's stories.
- **Check for news** syncs straight away, ignoring the usual wait between automatic tries.

## Today's paper

<img src="images/kindle/todays-paper.png" width="360" alt="Today's paper, six headlines">

- One large row per story: topic, headline, a one-line teaser and the reading time.
- A finished story turns grey and gets a tick. The dots at the top right fill in as the reader goes.
- Rows are tall on purpose, for a child's finger.

## A story

<img src="images/kindle/story-page.png" width="360" alt="The first page of a story: topic and reading time, the headline, a grey photo of a stadium with its credit, and the start of the text">

- Stories open in KOReader's normal reader: swipe or tap to turn the page.
- **Leaving early:** turning back from the first page (a left tap or a swipe right) closes the story and goes back to the headlines or front page it was opened from. What was read still counts; the story isn't marked read.
- **The photo:** most stories have the source's main photo under the headline, in grey and cropped to the page's width, with a credit. A story without one starts with its text. The photo makes a story about a page longer.
- The photo and the page are downloaded together, so a story never shows a missing picture.

## End of a story

<img src="images/kindle/story-finished.png" width="360" alt="The last page of a story with the Story finished panel">

- Every story ends with a **Word to know**, a **Think about it** question and the source.
- The **Story finished!** panel appears on turning forward from the last page, so it never covers unread text.
- **Next story** names the next unread story and opens it in one tap.

## Back issues

<img src="images/kindle/back-issues.png" width="360" alt="Back issues, the last five papers">

- The last 7 papers are kept on the Kindle, so this screen needs no network.
- Each row shows the day, the lead headline and how much of that paper was read.

## Sport

<img src="images/kindle/set-sport.png" alt="Sport on a Kindle Paperwhite 3: the Sport tile, closed until today's stories are read, the latest results, the table and a match">

When the [Sport page](sports-page.md) is on for a child, Sport is one of the front page's tiles, in place of Check for news, which moves to the bottom row beside Close. It never shows a score.

| Front page | Matches | Table | A match | Line-ups | Closed |
|:---:|:---:|:---:|:---:|:---:|:---:|
| <img src="images/kindle/sport-front-page.png" width="130" alt="The front page with the Sport tile"> | <img src="images/kindle/sport-matches.png" width="130" alt="Sport: the latest matchday's results"> | <img src="images/kindle/sport-table-1.png" width="130" alt="Sport: the table, places 1 to 10"> | <img src="images/kindle/sport-match.png" width="130" alt="A match: goals, cards and substitutions"> | <img src="images/kindle/sport-lineups.png" width="130" alt="A match: both line-ups"> | <img src="images/kindle/sport-closed.png" width="130" alt="Sport closed until three stories are read"> |

- **Closed first.** Until enough of today's stories have been read properly, the tile has a padlock and says how many more stories first, and tapping it shows the closed screen: the padlock, a dot for each story needed, and the headline of the next story that would count (an unread one first, then one read too quickly), which opens it. A story paged through too quickly doesn't count; if every story is read but not enough count, the tile says how many to read again. Reading on the iPad counts too, once the Kindle has synced.
- **Matches:** the latest matchday by day on one screen; his club's match is outlined and its winners in bold. A result with `›` opens.
- **Table:** ten clubs a page, his club's half first, his club in white on black. Tap `1 to 10` and `11 to 20`, or swipe.
- **Next:** the next round's fixtures with kick-off times.
- **A match:** two screens. The score, goals, cards, substitutions and injuries, then both line-ups side by side.
- It is the page fetched with the morning paper, kept on the Kindle, so it opens without Wi-Fi.

## With Simple UI

<img src="images/kindle/simpleui-home.png" width="360" alt="Simple UI home screen: a deck of book covers, reading goals and stats, with Early Edition in the navigation bar between Home and History">

If the [Simple UI](https://github.com/doctorhetfield-cmd/simpleui.koplugin) plugin is installed, Early Edition fits into it rather than taking over: it can sit in Simple UI's navigation bar, as here, or as Quick Action buttons on its home screen for the front page and today's paper. The [plugin README](../plugin/README.md#using-with-simple-ui) explains how to place them.

## Where it started

The design began as three mockups, made before any code. The name then was "Morning News".

| Headlines | Reading a story | End of a story |
|:---:|:---:|:---:|
| <img src="images/mockups/1-headlines.png" width="240" alt="Mockup: headlines"> | <img src="images/mockups/2-reading-a-story.png" width="240" alt="Mockup: reading a story"> | <img src="images/mockups/3-end-of-a-story.png" width="240" alt="Mockup: end of a story"> |

[DESIGN.md, section 11](DESIGN.md#11-mockups) lists where the build was expected to differ from them.

## Photo credits

The sample story is made up. Its photo is [Pitch side view, Wembley Stadium](https://commons.wikimedia.org/wiki/File:Pitch_side_view_-_Wembley_Stadium_-_geograph.org.uk_-_4624558.jpg) by Paul Gillett, [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0), from Wikimedia Commons.
