# The Kindle screens

What the child sees in KOReader. The plugin draws the front page, the headline list, the finished panel and back issues itself; stories open in KOReader's normal reader.

These are captures from the KOReader emulator at the Kindle Paperwhite's size. E-ink refresh, fonts and touch can only be judged on the real device.

| Front page | Today's paper | A story | End of a story | Back issues |
|:---:|:---:|:---:|:---:|:---:|
| <img src="images/kindle/front-page.png" width="160" alt="Front page"> | <img src="images/kindle/todays-paper.png" width="160" alt="Today's paper"> | <img src="images/kindle/story-page.png" width="160" alt="A story with its photo"> | <img src="images/kindle/story-finished.png" width="160" alt="End of a story"> | <img src="images/kindle/back-issues.png" width="160" alt="Back issues"> |

## Front page

<img src="images/kindle/front-page.png" width="360" alt="The Early Edition front page">

- **Masthead:** the date, the issue number and the title.
- **Today's paper:** how many stories and minutes, how many are read, a topic icon per story, and the first unread story with **Start reading**.
- **Back issues** and **My week** open their own screens.
- **Word of the day** comes from one of today's stories.
- **Check for news** syncs straight away, ignoring the usual wait between automatic tries.

## Today's paper

<img src="images/kindle/todays-paper.png" width="360" alt="Today's paper, six headlines">

- One large row per story: topic, headline, a one-line teaser and the reading time.
- A story he has finished turns grey and gets a tick. The dots at the top right fill in as he reads.
- Rows are tall on purpose, for a child's finger.

## A story

<img src="images/kindle/story-page.png" width="360" alt="The first page of a story: topic and reading time, the headline, a grey photo of a stadium with its credit, and the start of the text">

- Stories open in KOReader's normal reader: swipe or tap to turn the page.
- **The photo:** most stories have the source's main photo under the headline, in grey and cropped to the page's width, with a credit. A story without one starts with its text. The photo makes a story about a page longer.
- The photo and the page are downloaded together, so a story never shows a missing picture.

## End of a story

<img src="images/kindle/story-finished.png" width="360" alt="The last page of a story with the Story finished panel">

- Every story ends with a **Word to know**, a **Think about it** question and the source.
- The **Story finished!** panel appears when he turns forward from the last page, so it never covers text he hasn't read.
- **Next story** names the next unread story and opens it in one tap.

## Back issues

<img src="images/kindle/back-issues.png" width="360" alt="Back issues, the last five papers">

- The last 7 papers are kept on the Kindle, so this screen needs no network.
- Each row shows the day, the lead headline and how much of that paper he read.

## With Simple UI

<img src="images/kindle/simpleui-home.png" width="360" alt="Simple UI home screen with Early Edition shortcuts">

If the [Simple UI](https://github.com/doctorhetfield-cmd/simpleui.koplugin) plugin is installed, Early Edition adds two Quick Actions to it: the front page and today's paper. The [plugin README](../plugin/README.md#using-with-simple-ui) explains how to place them.

## Where it started

The design began as three mockups, made before any code. The name then was "Morning News".

| Headlines | Reading a story | End of a story |
|:---:|:---:|:---:|
| <img src="images/mockups/1-headlines.png" width="240" alt="Mockup: headlines"> | <img src="images/mockups/2-reading-a-story.png" width="240" alt="Mockup: reading a story"> | <img src="images/mockups/3-end-of-a-story.png" width="240" alt="Mockup: end of a story"> |

[DESIGN.md, section 11](DESIGN.md#11-mockups) lists where the build was expected to differ from them.

## Photo credits

The sample story is made up. Its photo is [Pitch side view, Wembley Stadium](https://commons.wikimedia.org/wiki/File:Pitch_side_view_-_Wembley_Stadium_-_geograph.org.uk_-_4624558.jpg) by Paul Gillett, [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0), from Wikimedia Commons.
