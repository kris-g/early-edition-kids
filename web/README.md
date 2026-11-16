# Early Edition Kids parent dashboard (web)

The parent dashboard for Early Edition Kids, as an installable PWA. React 19, TypeScript, Vite 8,
Tailwind 4, React Router 7 and `vite-plugin-pwa`. It talks only to the server's JSON API under `/api/dashboard`
([CONTRACT.md](../docs/CONTRACT.md), "Parent dashboard").

The product name lives in `src/config.ts`: `APP_NAME` is "Early Edition Kids" and the home-screen label
(`APP_SHORT_NAME`, the manifest's `short_name`) is "Early Edition", because iOS cuts labels off at about
12 characters' width. The manifest, page title and home-screen label all read from there.

## Sign-in: Authelia, or the server's own

The app has no login screen of its own. In the author's setup the dashboard is only reachable through
its HTTPS ingress (see CONTRACT.md), which Authelia protects at the cluster edge, so you sign in to
Authelia before the page loads. A plain Docker setup can set `DASHBOARD_PASSWORD` on the server
instead: the server then serves its own sign-in page at `/login`, the API answers 401 when signed out,
and More shows "Sign out" (`GET /api/dashboard/profiles` says whether it is on).

When the session expires, API calls get a redirect to Authelia (or a 401 from the server) instead of JSON. The app fetches
with `redirect: 'manual'`, treats that redirect (or a 401) as "signed out" and reloads the page once, so the
browser goes through the sign-in page and comes back. If it already reloaded in the last 30 seconds it
stops and shows "You're signed out. Reload to sign in again." with a button, so it can never loop.

Every non-GET request carries the header `X-Early-Edition: 1` (the server's CSRF guard).

## Several children

The app first asks `GET /api/dashboard/profiles`. With one profile nothing changes: pages under
`/dashboard/`, the API under `/api/dashboard`, no switcher. With more, each child's pages are under
`/dashboard/p/<id>/` and its API under `/api/dashboard/p/<id>`; the router is mounted per child
(`src/components/ProfileGate.tsx`, `src/lib/profile.ts`), so links inside the app are unchanged.
`/dashboard/` opens the child used last on this device (`early-edition.profile`), a switcher in the
phone header and the desktop sidebar shows the profile id, and switching keeps the section you were on.
The share-card name is kept per child (`early-edition.share-name.<id>`); the theme and dismissed tips are
per device.

## Design and theme

The look follows the approved mockups ("Early Edition Kids: parent dashboard designs": Main, Reading,
Calendar, AI and Desktop). Their colour tokens are CSS variables in `src/index.css` (`--bg`, `--card`,
`--ink`, `--muted`, `--line`, `--accent`, `--accent-soft`, `--warm`, `--warm-soft`, `--chip`,
`--on-accent`), exposed to Tailwind as `bg-card`, `text-muted`, `border-line` and so on. Inter and
Playfair Display are self-hosted from `@fontsource` (Latin subset), so nothing loads from Google and the
fonts are precached for offline use.

Light and dark: the default follows the system (`prefers-color-scheme`). The sun or moon button in the
phone header, or the "Dark theme" switch in the desktop sidebar, makes a manual choice, remembered in
`localStorage` (`early-edition.theme`). An inline script in `index.html` applies it before first paint,
and the `theme-color` meta tag follows it.

Charts are hand-built SVG and CSS (no chart library); each has an accessible label summarising its data.

## Pages

Phones get a bottom tab bar (Today, Reading, Calendar, AI, More); 900px and wider get a sidebar
(Overview, Reading, Calendar, Find articles, Topics, AI, then Back issues, Recent runs and More, and the
theme switch).

- **Today** (phone): reading streak with this week's days, today's paper (N of M read, progress, "On the
  Kindle", Add an article, Make it again with the 409 confirm flow), the stories with status pills and hide
  buttons, and the "Written at ... by ..." row that links to AI. Empty states for no paper and no streak.
- **Overview** (900px and wider, same address): streak and 14-day strip, stories per day with the range
  pills, the month, AI and cost, and today's paper.
- **Reading**: 14 days, 30 days or 12 weeks; streak now and longest, the day strip, stories per day with
  the average line, time reading, and what he reads by topic.
- **Calendar**: month grid with stories read per day (shaded 0, 1 to 2, 3 to 4, 5 or more), previous and
  next month, a day's stories and "Open this day's paper", and the month's totals.
- **AI**: last run, who writes (models grouped by provider), who checks and how hard, a live estimate and
  "Use from tomorrow's paper" (sends only what changed), the monthly limit, cost this month and per day,
  where a day's money goes, tokens, quality, and one row per provider with a line on what it is. API keys stay
  on the server.
- **Share** (sidebar, or More on a phone): six picture cards (Streak, Today, The week, Milestone, Words learned,
  Ask me about) in a row you swipe through, with dots and arrows; a name for the cards (kept on this device only)
  and a colour (Paper, Green, Night); Share… (the phone's share sheet), Copy image and Save image. Cards are drawn on
  a canvas in `src/lib/shareDraw.ts` from `GET /api/dashboard/share`; their wording is in `src/lib/shareCards.ts`.
- **Story**: the story as he sees it, its reading stats in words, the source link, hide and unhide,
  previous and next.
- **Find articles**: search the feed archive or paste a link; add to today or for tomorrow. Each add is
  rewritten and checked by the server; the page polls the job every 2 seconds and shows the new story or
  the reasons it was refused. Polling carries on while you move between pages.
- **Topics**: each topic with its description, an on/off switch (off is the API's `block`) and a Pin toggle, and
  "5 of 6 on" in the header. Details opens a row's base and effective weight and its shown, opened and engaged
  counts.
- **Devices**: the child's Kindle server address and the plugin's install steps, and the iPad reader's address
  with a QR code, then "About this server": its version, what it runs on and how long it has been running
  (`GET /api/dashboard/about`, the same for every child). Today and the Overview point here until a Kindle or an
  iPad has asked for a paper.
- **Back issues**, **Recent runs** and **More** (links, home-screen help, and "Signed in through Authelia" or, with the server's own sign-in, "Sign out").

## Develop with the mock API

`mock/server.ts` is a small Express server that implements every dashboard route on one port (8090) with
fake data: 120 days of issues (6 stories a day, with a few missed days so streaks break), reading stats,
calendar months, topics, search hits, the AI models the server offers by default from two providers (Anthropic and OpenRouter) with
estimates, a month of costs, `PUT /ai` that validates like the contract and keeps changes in memory, add
jobs that finish after 4 seconds, and one article that fails the checks ("Storm Bert", or any pasted URL
containing `fail`).

```sh
npm install
npm run dev:mock      # mock on :8090 plus Vite on :5173, both proxies pointed at the mock
```

Open http://localhost:5173/dashboard/. There is nothing to sign in to.

To see what an expired Authelia session looks like, open http://localhost:8090/__mock/signed-out?on=1;
every dashboard API call then answers with a redirect. `?on=0` undoes it.

Mock options (environment variables): `MOCK_PROFILES=older,younger` (two children, each with its own data, to see the switcher and the `/p/<id>/` addresses), `MOCK_LOGIN=1` (as if the server had `DASHBOARD_PASSWORD`, to see "Sign out" on More), `MOCK_NO_ISSUE=1` (no issue today, to see the empty state),
`MOCK_DELAY` (ms of latency, default 250), `MOCK_JOB_MS` (default 4000), `PORT` (default 8090).
The mock keeps everything in memory; restart it to reset. `npm run mock:watch` restarts it on changes.

## Develop against the real server

The server listens on two ports: the dashboard API on 8081 and the Kindle routes on 8080. Locally both
bind to 127.0.0.1 and have no auth. Start it from `../server`, then:

```sh
npm run dev           # Vite proxies /api/dashboard -> :8081, the rest of /api -> :8080
```

Point the proxies elsewhere with `EARLY_EDITION_KIDS_DASHBOARD_API` (default `http://localhost:8081`)
and `EARLY_EDITION_KIDS_API` (default `http://localhost:8080`).

## Checks

```sh
npm run typecheck     # tsc -b
npm run lint          # ESLint, same config as the other dashboards
npm test              # Vitest + React Testing Library
npm run build         # tsc -b && vite build -> dist/
```

The API types are not copied: `src/api/types.ts` re-exports the server's types-only file (v1 and v2),
`../server/src/dashboard/types.ts`, so the two sides cannot drift. Building this app therefore needs the
`server/` directory next to `web/` (a Docker build must use the repository root as its context).

## Build and serving

`npm run build` writes static files to `dist/`: `index.html`, hashed assets, `manifest.webmanifest`,
`sw.js` and the icons. Vite's `base` is `/dashboard/`, and the server serves `dist/` at `/dashboard/` on
its dashboard port with an SPA fallback to `index.html`. Nothing else is needed at run time.

Icons are generated from one SVG design (a bold "E" on emerald) with sharp: `npm run icons` rewrites
`public/favicon.svg`, `pwa-192.png`, `pwa-512.png`, `maskable-512.png` and `apple-touch-icon.png`.

## PWA, offline and HTTPS

- The service worker (Workbox, via `vite-plugin-pwa`, `registerType: autoUpdate`) precaches the app shell.
- Page loads (navigations) are network first and are never answered from the precache while online, so an
  expired Authelia session sends you to its sign-in page rather than showing a stale shell. Offline, the
  last copy of the page, or the precached shell, is used.
- `GET /api/dashboard/*` is network first with a 4 second timeout, so the last data shows when offline.
  It never caches POSTs, job polling or redirects (only 200 responses are stored), and leaves the Kindle's
  routes (`/api/issue/*`, `/issues/*`) alone.
- **Service workers and installing need HTTPS (or `localhost`).** Through the Authelia-protected HTTPS
  ingress you get both. On a plain-HTTP address the dashboard still works and "Add to Home Screen" still
  makes a home-screen shortcut that opens full screen, but there is no service worker, so no offline copy
  and no install prompt.

## Add to the home screen

**iPhone (Safari):** open the dashboard URL, tap the Share button, then **Add to Home Screen**, then
**Add**. It opens full screen as "Early Edition". (iOS uses the `apple-mobile-web-app-*` meta tags and the
180 px touch icon for this.) Authelia may ask you to sign in again inside the home-screen app the first
time, because it keeps its own cookies.

**Android (Chrome):** open the dashboard URL, tap the three-dot menu, then **Add to home screen** or
**Install app**. Over HTTPS Chrome installs it as an app with the maskable icon.
