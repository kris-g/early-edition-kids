# Early Edition Kids: iPad reader

The child's reader on an iPad: the Kindle's paper with the stories' photos and colour, opened from a home-screen icon. Plain TypeScript and Vite, no framework. The look and behaviour follow the approved mock-up in [`docs/mockups/ipad-reader/`](../docs/mockups/ipad-reader/); [CONTRACT.md, "iPad reader"](../docs/CONTRACT.md#ipad-reader-added-16-november-2026) has the rules it keeps.

The server serves the built files on the Kindle port at `/read/` for the root profile and `/p/<id>/read/` for every profile. Everything is relative, so one build works under every mount.

## Develop

```bash
npm ci --cache "$TMPDIR/npm-cache"
npm run dev        # http://localhost:5174/, with /api and /issues proxied to the server on :8080
```

Start the server first with the stub writer (see [`server/README.md`](../server/README.md), or the `early-edition-kids-server-dev` configuration in `.claude/launch.json`) and make a paper with `POST /admin/generate`. The dev page is the root profile's reader; for another profile, build and open `http://localhost:8080/p/<id>/read/` from the server.

To try it on an iPad, build it, run the server with `HOST=0.0.0.0`, and open `http://<computer's address>:8080/read/` in Safari on the same Wi-Fi.

## Check

```bash
npm test           # vitest (jsdom)
npm run lint
npm run build      # type check, then dist/
```

## How it is put together

| File | What it does |
|---|---|
| `src/app.ts` | Screens, moving about, pages and the long paper, reading sessions and their events |
| `src/views.ts` | Each screen as HTML (front page, story, Story finished, Back issues, My week, waiting) |
| `src/styles.css` | The mock-up's styles, with the new screens and the iPad's safe areas |
| `src/library.ts` | The papers kept on the iPad, read marks, and the Kindle's rules for versions and profiles |
| `src/events.ts`, `src/uploader.ts` | The event queue and sending it in batches |
| `src/tracker.ts` | Active reading time and pages, as the plugin measures them |
| `src/readlog.ts` | The reading log, My week and the streak |
| `src/body.ts` | Reads a story's text from the story page the Kindle downloads |
| `src/look.ts` | Text size and page colour (paper, sepia, night) from the Aa button on a story |
| `src/storage.ts` | `localStorage`, namespaced per profile mount |

Everything from the server is escaped before it is shown; story paragraphs keep only text and bold.

## Fonts and icons

The fonts come from the `@fontsource` packages (`src/fonts.css`, Latin and Latin Extended only) and are part of the build, so the iPad never fetches a font from anywhere else. They are under the SIL Open Font License; the licences are in `public/fonts/`.

`npm run icons` redraws `public/apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `favicon.svg` from the sunrise mark, in plain JS with no image library.
