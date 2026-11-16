/**
 * The iPad reader (reader/, CONTRACT.md "iPad reader"): a static front end served on the Kindle port at
 * <mount>/read/ for every profile mount, plus its per-mount web app manifest and settings. One build
 * works under every mount because it uses relative paths; the server only fills in the profile's
 * title for the home-screen name.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import express, { Router, type Request, type Response } from "express";
import type { Context } from "./pipeline.js";

/** Newsprint white: the reader's ground, status bar and splash colour. */
export const READER_THEME = "#fafaf7";
const TITLE_PLACEHOLDER = /__EEK_TITLE__/g;

/** Only the home server: no other hosts, no frames, no forms, nothing to follow out of the paper. */
export const READER_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** `GET <mount>/api/reader`: what the reader needs to know about this profile. */
export function readerSettings(ctx: Context) {
  return {
    profile: ctx.profileId,
    profile_root: ctx.profileRoot,
    title: ctx.config.title,
    mode: ctx.config.readerMode,
    age: ctx.config.childAge,
  };
}

/** The web app manifest for one mount; `base` is the reader's own path, such as /p/younger/read/. */
export function readerManifest(ctx: Context, base: string) {
  const title = ctx.config.title;
  return {
    id: base,
    name: title,
    short_name: title,
    description: "Today's paper, written for you.",
    lang: "en-GB",
    start_url: base,
    scope: base,
    display: "standalone",
    orientation: "any",
    background_color: READER_THEME,
    theme_color: READER_THEME,
    icons: [
      { src: "apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

/** Mounted at <mount>/read on the Kindle app. */
export function readerRouter(ctx: Context, readerDir: string): Router {
  const dir = path.resolve(readerDir);
  const router = Router();
  const indexFile = path.join(dir, "index.html");
  let indexCache: { mtime: number; html: string } | null = null;
  let serve: express.RequestHandler | null = null;

  const indexHtml = (): string | null => {
    if (!existsSync(indexFile)) return null;
    const mtime = statSync(indexFile).mtimeMs;
    if (!indexCache || indexCache.mtime !== mtime) indexCache = { mtime, html: readFileSync(indexFile, "utf8") };
    return indexCache.html;
  };

  const notBuilt = (res: Response) =>
    res.status(503).type("text/plain").send("iPad reader not built (run npm run build in reader/, or set EARLY_EDITION_KIDS_READER_DIR)");

  const sendIndex = (_req: Request, res: Response) => {
    const html = indexHtml();
    if (html === null) return notBuilt(res);
    res
      .set({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": READER_CSP,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      })
      .send(html.replace(TITLE_PLACEHOLDER, escapeHtml(ctx.config.title)));
  };

  router.get("/", (req, res) => {
    // /read without the slash: relative asset and API paths need it.
    if (!req.originalUrl.split("?")[0].endsWith("/")) {
      const [p, q] = req.originalUrl.split("?");
      res.redirect(301, `${p}/${q ? `?${q}` : ""}`);
      return;
    }
    sendIndex(req, res);
  });
  router.get("/index.html", sendIndex);

  router.get("/manifest.webmanifest", (req, res) => {
    res
      .set({ "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" })
      .send(JSON.stringify(readerManifest(ctx, `${req.baseUrl}/`)));
  });

  const setHeaders = (res: Response, file: string) => {
    const rel = path.relative(dir, file).split(path.sep);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (rel[0] === "assets") res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else res.setHeader("Cache-Control", "public, max-age=3600");
  };

  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!existsSync(indexFile)) return notBuilt(res);
    serve ??= express.static(dir, { index: false, redirect: false, setHeaders, fallthrough: true, dotfiles: "ignore" });
    serve(req, res, next);
  });
  return router;
}
