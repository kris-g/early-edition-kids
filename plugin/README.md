# Early Edition Kids plugin for KOReader

The Kindle half of Early Edition Kids: fetches the daily kids' news issue from the Early Edition Kids
server on the home network, shows its own "front page" (masthead, today's
paper, back issues, my week, word of the day), opens each story in
KOReader's normal reader, and reports what was read.

## Install

1. Download `earlyeditionkids.koplugin-<version>.zip` from the [latest release](https://github.com/kris-g/early-edition-kids/releases/latest) and unzip it.
2. Connect the Kindle by USB and copy the `earlyeditionkids.koplugin` folder to
   `koreader/plugins/` on the Kindle's drive (`/mnt/us/koreader/plugins/` on the device).
3. Restart KOReader. "Early Edition" (opens the front page) and "Early
   Edition settings" appear in the Tools menu (the spanner tab), in both the
   file browser and the reader.
4. Open **Tools → Early Edition settings → Server address** and type the server's
   address, such as `http://192.168.1.50:8080`: the IP address of the computer running
   the server, and port 8080. Use an IP address unless the Kindle can resolve a local
   hostname; plain HTTP on the home network is fine. **Save and check** fetches today's
   paper straight away, or says what went wrong.

To update, copy the new release's folder over the old one. The server address and
reading history are kept in KOReader's settings, not in the plugin folder.

**Prefer a file?** Copy `config.example.lua` to `config.lua` in the plugin folder and set
`server_url` there instead. Release zips never contain `config.lua`, so an update never
overwrites it. An address set from the menu takes precedence over the file. The file can
also set `earliest_fetch_hour`: no automatic look for today's issue before this hour,
London time (default 5).

From a git checkout, the plugin is the `plugin/earlyeditionkids.koplugin` folder itself.

Recommended KOReader settings:

- **Network → Action when Wi-Fi is off → Turn on.** Without this, Early Edition Kids
  never brings Wi-Fi up on its own; it waits for the Kindle to reconnect by
  itself and syncs then. It never shows a Wi-Fi prompt on an automatic sync.
- Optional: **Gestures** (or Profiles) → assign "Early Edition: front page" to a
  gesture, so the paper is one swipe away while he is in his own book.
  "Early Edition: today's paper" and "Early Edition: check for news" also exist.

## Using with Simple UI

[Simple UI](https://github.com/doctorhetfield-cmd/simpleui.koplugin) (MIT)
replaces KOReader's file browser with its own home screen. Early Edition
works alongside it:

- **It does not take over the screen.** With Simple UI installed and switched
  on, "Open Early Edition by itself" defaults to off, so KOReader starts on
  Simple UI's home screen and a new paper only shows a short notice. Turn it
  on in **Tools → Early Edition settings → Open Early Edition by itself** if
  you want the front page to open anyway. A choice made with the older
  "Open the front page when KOReader starts" switch is kept.
- **Quick Actions.** Early Edition adds two actions to Simple UI's list:
  **Early Edition** (opens the front page; its label shows unread stories,
  e.g. "Early Edition · 4 new") and **Today's paper** (opens the headline
  list). Simple UI shortens long labels in narrow buttons, so with four or
  more buttons in a row the count may be cut off.
  - On the home screen: **Tools → Simple UI → Home Screen → Modules → Edit
    Home Screen Layout** and add a **Quick Actions Row**, then **Tools →
    Simple UI → Home Screen → Modules → Module Settings → Quick Actions →
    Quick Actions Row → Quick Actions** and pick "Early Edition" (and
    "Today's paper"). Long-pressing the row on the home screen opens the
    same settings.
  - On the navigation bar: **Tools → Simple UI → Bars → Navigation Bar →
    Tabs** and add "Early Edition".
  - Prefer a Dispatcher action? Simple UI's custom Quick Actions
    (**Tools → Simple UI → Quick Actions**) can run "Early Edition: front
    page", "Early Edition: today's paper" or "Early Edition: check for news".
- **Leaving.** Closing the front page with no book to go back to returns to
  Simple UI's home screen (its "Go to Homescreen" action) rather than the
  plain file browser. If he came from one of his own books, that book is
  reopened as before.

Simple UI is not required, and if it changes its plugin API in a later
version Early Edition keeps working; only the Quick Actions would be missing.

## Leave the Kindle in KOReader overnight

KOReader only runs plugins while it is in the foreground, and the Kindle
cannot wake itself to download. Leave it in KOReader (asleep is fine) and the
issue downloads a few seconds after he wakes it in the morning. If the Kindle
is left in the Amazon home screen, nothing happens until KOReader is started.

## Screens

- **Front page** (the entry point): date and edition number, the masthead,
  the "Today's paper" card (read count, stories and minutes, a topic icon
  per story, FIRST UP = the first unread story, a big Start reading button),
  tiles for Back issues, My week, Word of the day and Check for news (with
  "Updated HH:MM"), and the sources line. "Close" (or swipe down) leaves
  Early Edition.
- **Today's paper**: one row per story with its topic icon, a "2 min" chip,
  or a tick once read (read rows are greyed). More stories than fit go on
  further pages ("N more stories" row, or swipe).
- **Story finished!**: docked under the last page with a READ stamp,
  progress dots and the next story; "All headlines" and "Front page".
- **Back issues**: the papers kept on the Kindle (7 days), newest first.
- **My week**: Monday to Sunday, from the reading log on the Kindle only:
  stories a day, stories this week, days in a row, topics, words learned.
  Counts and streaks only.

Edition number, "Updated" time and word of the day come from the server's
`number`, `created_at` and `word_to_know` fields when it sends them; without
them the plugin counts the papers on the Kindle, uses the download time, and
reads the "Word to know" box from the story page.

The page background is white: the mockups' paper tone (#ECEAE4) is not
painted, because a light grey costs contrast on e-ink and ghosts under
partial refreshes. Today's back-issue card uses a light grey highlight.

## What it does

- On KOReader start and on every wake it syncs if it is after
  `earliest_fetch_hour` and today's issue is missing, if there are new
  events to upload, or if the last check of today's issue is over 30 minutes
  old. After a 404 (issue not ready) it waits 30 minutes; after a network
  failure, 2 minutes. "Check for news" (front page or settings menu) ignores that.
- **Open Early Edition by itself** (Early Edition settings): when on, the
  front page opens on its own when KOReader starts with no book open and
  today's paper is already on the Kindle, and when a new issue arrives with
  no book open. When off, a new issue only shows a short notification. On by
  default, off by default when Simple UI is installed (see below). Over one
  of his own books it never takes over, whatever the setting.
- **Catching up missed days.** After each check of today's paper that reaches
  the server (automatic, or "Check for news" from the menu or Simple UI;
  also when today's paper is not ready yet), it also asks
  the server (`GET /api/issue/<date>`) for each of the previous 6 days that
  are not on the Kindle, so a Kindle left alone for a few days gets the
  papers it missed in Back issues on its next sync. These are stored like
  today's paper but quietly: no notice, no screen opens, nothing is marked
  opened. At most 6 requests per sync; a day with no paper (404) is not asked
  again until the next day; the first network failure stops the catch-up
  until a later sync. A paper already on the Kindle is never fetched again,
  even if the server has a newer version of it.
- Stories are stored in `koreader/earlyeditionkids/<date>/`, 7 days are kept. KOReader's
  reading-position files for them are removed with them.
- If a parent adds a story to today's issue, it appears after the next check
  (within 30 minutes of waking, or at once with "Check for news").
- Reading opens a normal KOReader page. Turning forward from the last page
  shows the "Story finished!" panel instead of KOReader's end-of-book pop-up.
  Leaving a story any other way goes back to the screen it was opened from.
- Closing the front page restores his own book as KOReader's "last
  file", removes the stories from History, and reopens his book if he was
  reading it when he went to the news.
- State is in `koreader/settings/earlyeditionkids.lua` (device id, queue, sync
  state, settings) and the reading log in
  `koreader/settings/earlyeditionkids_log.lua` (one year).
- Early Edition settings → Status shows the server, last check, queued events
  and the device id.

## Sending a crash log

If something goes wrong, connect the Kindle by USB and send
`koreader/crash.log` (on the Kindle: `/mnt/us/koreader/crash.log`). Early Edition Kids
logs lines starting `Early Edition Kids:`. For more detail turn on
Tools → More tools → Developer options → Enable debug logging, reproduce,
and send the log again.

## Tests

The tests run under LuaJIT, the same interpreter KOReader uses on the Kindle.
Install it once, then run the suite:

```sh
brew install luajit
cd plugin
./spec/run.sh            # same as: luajit spec/run.lua
```

The runner compiles every `.lua` file, then runs `spec/*_spec.lua`:

- `clock_spec`, `syncrules_spec`: London dates and summer time, the sync
  rules, back-off, a wrong device clock corrected by the server's Date header;
- `events_spec`: queue, accepted ids, 7-day drop of refused events, batching,
  wire format;
- `syncer_spec`: download, 404, network failure, hidden/unhidden stories,
  stories a parent adds to today's issue (same version, shown in `position`
  order), version replacement only when nothing was opened, 7-day tidy,
  and the back-issue catch-up (missing days stored, hidden lists, 404
  remembered for the day, stop on a network failure, the 7-day window, at
  most 6 requests, newer versions of stored days left alone, the Kindle left
  for four days);
- `misc_spec`: reading log retention and stats helpers, the reading timer,
  JSON, the store;
- `models_spec`: first unread story, word of the day (API field or story
  page), edition number fallback, "Updated" time, the front page and back
  issue models, My week (days, totals, topics, words, days in a row), the
  stamp drawn without `<text>`;
- `ui_flow_spec` (Simple UI part): the auto-open default with and without
  Simple UI, migration of the old switch, no auto-open at start or on a new
  issue when off, Quick Action registration with a fake Simple UI (once,
  live unread label, execute opens the front page, unregister when the
  plugin stops), Simple UI loading after us, a broken Simple UI, and leaving
  to its home screen;
- `ui_flow_spec`: `main.lua`, the controller and the screens run against
  stubbed KOReader modules (`koreader_stubs.lua`), including counts after a
  parent adds a story and paging when there are more stories than fit. This
  checks the glue code runs; it does not replace the emulator or the Kindle.

## Screenshot tour (development only)

Starting KOReader with `EEK_SCREENSHOT_TOUR=1` skips syncing, shows the front
page, today's paper, a story's last page with the finished panel, back
issues and my week in turn, saves `1-front-page.png` ... `5-my-week.png` into
`$KO_HOME/screenshots/`, and quits. With Simple UI installed it first saves
`0-simpleui-home.png` (Simple UI's home screen at start) and logs whether our
front page opened by itself, then opens the front page through our Quick
Action. It opens a story, so run it on a copy of
the data folder. On a Mac with a Retina display, ask for a 536 x 724 window
to get a 1072 x 1448 pixel screen (the emulator window is HiDPI):

```sh
cd KOReader.app/Contents/koreader
KO_HOME=/path/to/copy EMULATE_READER_W=536 EMULATE_READER_H=724 EMULATE_READER_DPI=300 \
  KOREADER_WINDOW_POS_X=40 KOREADER_WINDOW_POS_Y=80 EEK_SCREENSHOT_TOUR=1 ../MacOS/koreader
```

## Releases

Pushing a version tag builds the release:

```sh
git tag v1.0.0 && git push github v1.0.0
```

The Plugin workflow (`.github/workflows/plugin.yml`) runs these tests under LuaJIT, then
`plugin/package.sh` builds `earlyeditionkids.koplugin-1.0.0.zip` with the version stamped
into `const.lua` and `_meta.lua` (shown on the Status screen), and attaches it to a GitHub
Release. The same tag makes the Image workflow publish the server image as `:1.0.0`.
`sh plugin/package.sh v1.0.0` builds the same zip locally, into `dist/`.

## Files

```
earlyeditionkids.koplugin/
  _meta.lua, main.lua, config.example.lua (copy to config.lua)
  earlyeditionkids/const.lua            names, numbers and the version
  earlyeditionkids/serverurl.lua        checks and tidies the server address typed on the Kindle
  earlyeditionkids/clock.lua            Europe/London dates, clock skew
  earlyeditionkids/store.lua            state in the settings file
  earlyeditionkids/events.lua           event queue
  earlyeditionkids/readinglog.lua       reading log (for the later stats screen)
  earlyeditionkids/syncrules.lua        when to sync, back-off
  earlyeditionkids/syncer.lua           one sync run
  earlyeditionkids/issues.lua           issue storage, hidden, tidy
  earlyeditionkids/api.lua              HTTP API client
  earlyeditionkids/jsonutil.lua         rapidjson, or a pure-Lua fallback
  earlyeditionkids/tracker.lua          active reading time and pages
  earlyeditionkids/uuid.lua             event and device ids
  earlyeditionkids/env.lua              KOReader adapters (files, HTTP, settings, sidecars)
  earlyeditionkids/storyinfo.lua        word to know and source from a story page
  earlyeditionkids/models.lua           what each screen shows (pure, tested)
  earlyeditionkids/icons.lua            topic icons, recolouring, the READ stamp
  earlyeditionkids/controller.lua       behaviour: sync, screens, Early Edition session
  earlyeditionkids/simpleui.lua        Simple UI bridge: Quick Actions, home screen (guarded)
  earlyeditionkids/tour.lua             screenshot tour (EEK_SCREENSHOT_TOUR=1 only)
  earlyeditionkids/ui/widgets.lua       "Morning paper" pieces: text, icons, boxes, dots, buttons, page
  earlyeditionkids/ui/frontpage.lua     A1 front page
  earlyeditionkids/ui/headlines.lua     A2 today's paper
  earlyeditionkids/ui/finishedpanel.lua A3 story finished panel
  earlyeditionkids/ui/backissues.lua    A4 back issues
  earlyeditionkids/ui/myweek.lua        A5 my week
  icons/simpleui/*.svg                  Quick Action icons in Simple UI's style
  icons/*.svg                           topic icons (7 + fallback), sunrise, tiles, tick, arrows, stamp
  fonts/PlayfairDisplay-Black.ttf       masthead font (SIL Open Font License, fonts/OFL.txt)
spec/                                   tests (see above)
```
