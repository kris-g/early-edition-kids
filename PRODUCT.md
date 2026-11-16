# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **The child reader.** A UK child reading a short daily news paper made for them, on a Kindle (KOReader) or, from this work on, an iPad opened from a home-screen icon. Readers span several ages, so each child has a profile with its own age, story length, topics and sources, and the reader's sizes follow that profile. They read alone, mostly in the morning before school, for a few minutes.
- **The parent.** Sets the paper up, checks what was read, and hides or adds stories from a dashboard, mostly on a phone.

## Product Purpose

Every morning the server picks about six real news stories, rewrites each at the child's reading level, checks them, and has them waiting on the child's device. Success: the paper is ready before 07:00 with no adult action, a story takes one to two minutes to read, the child reads most of it most days, and nothing upsetting ever reaches them.

## Positioning

A newspaper of the child's own: real news from real sources, rewritten and checked for one reader's age and interests, on a device with nothing else on it to pull them away. It runs entirely on the family's own server.

## Operating Context

- The paper is finite: about six stories a day, with a visible end. There is no feed and nothing to scroll forever.
- Each story ends with a Word to know, a Think about it question and the source's name.
- Finishing a story marks it read. The child sees counts and a streak, never a score or a telling-off for a missed day.
- Back issues (the last seven papers) and My week are the only other places to go.
- The iPad is a shared family device, held either way up. The reader is a home-screen web app with no browser chrome and no links out.

## Capabilities and Constraints

- The child's reader and the parent dashboard are on different addresses; the reader must offer no route to the dashboard.
- Stories can carry the source article's main image: in colour on the iPad, in grey on the Kindle's story pages. Not every story will have one, so every layout must hold without it.
- The Kindle has no colour and shows photos only on story pages; the two readers show the same paper.
- Stories are short rewrites for one household, with the source named. Nothing is redistributed.
- Europe/London dates, British English.

## Brand Commitments

- The child sees the title "Early Edition" (configurable per profile), with the sunrise mark, the dated masthead with an issue number, the line "The news, written for you", the topic icons, and the round Read stamp.
- The Kindle paper is the reference: the iPad paper is the same paper, with colour and more photos.
- Tone: curious and upbeat, never babyish, never frightening.

## Evidence on Hand

- Kindle screens: `docs/images/kindle/`. Original mockups: `docs/images/mockups/`.
- Marks and icons: `plugin/earlyeditionkids.koplugin/icons/` (sunrise, stamp, topic icons). Masthead face: `plugin/earlyeditionkids.koplugin/fonts/PlayfairDisplay-Black.ttf`.
- Parent dashboard tokens: `web/src/index.css`.
- Story photos are stored with each story (CONTRACT.md "Story photos"); sample photos for screenshots are from Wikimedia Commons (`docs/tools/sample-paper.mts`).

## Product Principles

1. The stories are the product. Everything else gets out of their way.
2. The paper ends. Finishing it is the reward.
3. Nothing about the child leaves the house, and nothing on the child's screen leads out of the paper.
4. One paper, whatever the device.
5. Sized for the reader's age, never talked down to.

## Accessibility & Inclusion

Early readers: large type set by the profile, generous line spacing, big touch targets for a child's finger, and nothing that depends on colour alone.
