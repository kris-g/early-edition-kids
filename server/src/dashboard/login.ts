/**
 * Optional built-in sign-in for the dashboard port (CONTRACT.md "Built-in sign-in"), for setups with
 * no authenticating proxy in front. Off unless DASHBOARD_PASSWORD is set; then everything on the
 * dashboard port except /healthz and these routes needs a session cookie.
 *
 * The cookie is stateless: an expiry time and an HMAC-SHA256 of it, keyed from the password (and
 * SESSION_SECRET when set), so changing either signs everyone out. Failed sign-ins are limited per
 * connecting address, in memory.
 */

import { createHmac, scryptSync } from "node:crypto";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import { safeEqual } from "../http.js";

export const SESSION_COOKIE = "eek_session";
export const SESSION_DAYS = 30;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 60_000;

export interface LoginOptions {
  password: string;
  user: string;
  secret: string;
  clock?: () => Date;
}

/** `next` is honoured only as a path on this site under /dashboard. */
export function safeNext(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 2000) return null;
  if (!/^\/dashboard(?:[/?#]|$)/.test(v)) return null;
  if (/[\\\s]|\/\/|%2f|%5c/i.test(v.slice(0, v.search(/[?#]|$/)))) return null;
  if (/[\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** https as the browser sees it, behind a TLS-terminating proxy too. */
function isHttps(req: Request): boolean {
  const proto = String(req.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  return req.secure || proto === "https";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class DashboardLogin {
  private readonly key: Buffer;
  private readonly clock: () => Date;
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly opts: LoginOptions) {
    this.clock = opts.clock ?? (() => new Date());
    // scrypt, so a stolen cookie is no shortcut to guessing the password.
    this.key = scryptSync(opts.password, `early-edition-kids session v1\0${opts.user}\0${opts.secret}`, 32);
  }

  /** A cookie value valid for SESSION_DAYS from now. */
  issue(now = this.clock()): string {
    const exp = Math.floor(now.getTime() / 1000) + SESSION_DAYS * 86400;
    return `v1.${exp}.${this.sign(`v1.${exp}`)}`;
  }

  verify(value: string | undefined, now = this.clock()): boolean {
    if (!value) return false;
    const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
    if (!m) return false;
    if (!safeEqual(m[2], this.sign(`v1.${m[1]}`))) return false;
    return Number(m[1]) * 1000 > now.getTime();
  }

  private sign(data: string): string {
    return createHmac("sha256", this.key).update(data).digest("base64url");
  }

  signedIn(req: Request): boolean {
    return this.verify(parseCookies(req.get("cookie"))[SESSION_COOKIE]);
  }

  private address(req: Request): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  /** Recent failures from this address, pruned to the window. */
  private recent(addr: string, now: number): number[] {
    const list = (this.failures.get(addr) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
    if (list.length) this.failures.set(addr, list);
    else this.failures.delete(addr);
    return list;
  }

  private fail(addr: string, now: number): void {
    if (this.failures.size > 10_000) {
      for (const a of [...this.failures.keys()]) this.recent(a, now);
    }
    this.failures.set(addr, [...this.recent(addr, now), now]);
  }

  private cookie(res: Response, req: Request, value: string, maxAge: number): void {
    const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax"];
    if (isHttps(req)) parts.push("Secure");
    res.append("Set-Cookie", parts.join("; "));
  }

  /** GET/POST /login and POST /logout. Mount before guard(). */
  routes(): Router {
    const router = Router();
    const form = express.urlencoded({ extended: false, limit: "8kb" });

    router.get("/login", (req, res) => {
      const next = safeNext(req.query.next);
      if (this.signedIn(req)) {
        res.redirect(302, next ?? "/dashboard/");
        return;
      }
      this.page(res, 200, next, null);
    });

    router.post("/login", form, (req, res) => {
      const next = safeNext(req.body?.next);
      const addr = this.address(req);
      const now = this.clock().getTime();
      if (this.recent(addr, now).length >= MAX_FAILURES) {
        this.page(res, 429, next, "Too many tries. Wait a minute, then try again.");
        return;
      }
      const user = typeof req.body?.user === "string" ? req.body.user.trim() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      // Compare both, always, so the time taken does not say which was wrong.
      const userOk = safeEqual(this.opts.user ? user : "", this.opts.user);
      const passwordOk = safeEqual(password, this.opts.password);
      if (!userOk || !passwordOk) {
        this.fail(addr, now);
        this.page(res, 401, next, this.opts.user ? "That user name and password do not match." : "That password is not right.");
        return;
      }
      this.failures.delete(addr);
      this.cookie(res, req, this.issue(), SESSION_DAYS * 86400);
      res.redirect(303, next ?? "/dashboard/");
    });

    router.post("/logout", (req, res) => {
      this.cookie(res, req, "", 0);
      res.set("Cache-Control", "no-store").redirect(303, "/login");
    });

    return router;
  }

  /** Everything after this needs a session: 401 JSON for the API, a redirect to /login for pages. */
  guard() {
    return (req: Request, res: Response, next: NextFunction) => {
      if (this.signedIn(req)) return next();
      res.set("Cache-Control", "no-store");
      if (req.path.startsWith("/api/") || (req.method !== "GET" && req.method !== "HEAD")) {
        res.status(401).json({ error: "You’re signed out. Sign in again." });
        return;
      }
      const target = safeNext(req.originalUrl);
      res.redirect(302, target ? `/login?next=${encodeURIComponent(target)}` : "/login");
    };
  }

  private page(res: Response, status: number, next: string | null, error: string | null): void {
    res
      .status(status)
      .set("Cache-Control", "no-store")
      .set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
      .type("html")
      .send(loginPage({ user: Boolean(this.opts.user), next, error }));
  }
}

/** The sign-in page: the dashboard's colours (web/src/index.css), light and dark, no external files. */
export function loginPage(o: { user: boolean; next: string | null; error: string | null }): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f4f2ec">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="robots" content="noindex">
<title>Sign in · Early Edition</title>
<script>
(function () {
  var t = null;
  try { t = localStorage.getItem('early-edition.theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    try { t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { t = 'light'; }
  }
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'dark' ? '#111312' : '#f4f2ec');
})();
</script>
<style>
:root { --bg:#f4f2ec; --card:#fff; --ink:#171717; --muted:#5f5e5a; --line:#e2dfd6; --accent:#0b6b53;
  --on-accent:#fff; --danger:#b42318; --danger-soft:#fde8e6; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#111312; --card:#1b1e1c; --ink:#f2f0ea;
  --muted:#a9a8a2; --line:#2f3330; --accent:#4ade9f; --on-accent:#0b1f17; --danger:#ff8a80; --danger-soft:#3b1714; color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#111312; --card:#1b1e1c; --ink:#f2f0ea; --muted:#a9a8a2; --line:#2f3330;
  --accent:#4ade9f; --on-accent:#0b1f17; --danger:#ff8a80; --danger-soft:#3b1714; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body { background: var(--bg); color: var(--ink); font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; display: flex; justify-content: center;
  padding: max(48px, env(safe-area-inset-top)) 16px 48px; }
main { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 20px; }
.brand { display: flex; align-items: center; gap: 10px; color: var(--ink); }
.brand svg { width: 36px; height: 36px; color: var(--accent); }
.brand b { display: block; font-family: "Playfair Display", Georgia, "Times New Roman", serif; font-weight: 900; font-size: 22px; line-height: 1.1; }
.brand small { display: block; font-size: 11px; font-weight: 700; letter-spacing: .12em; color: var(--muted); }
form { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
h1 { margin: 0; font-size: 20px; font-weight: 700; }
p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.45; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; }
input { font: inherit; font-size: 16px; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; min-height: 44px; padding: 0 12px; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { font: inherit; font-size: 15px; font-weight: 700; min-height: 44px; border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent); cursor: pointer; }
.error { background: var(--danger-soft); color: var(--danger); border-radius: 10px; padding: 10px 12px; font-size: 14px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 36h36" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M13 36a11 11 0 0 1 22 0z" fill="currentColor"/><path d="M24 12v6M10.5 18.5l4 4M37.5 18.5l-4 4" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none"/></svg>
    <span><b>Early Edition</b><small>PARENT DESK</small></span>
  </div>
  <form method="post" action="/login">
    <h1>Sign in</h1>
    <p>You stay signed in on this device for ${SESSION_DAYS} days.</p>
    ${o.error ? `<div class="error" role="alert">${esc(o.error)}</div>` : ""}
    ${o.next ? `<input type="hidden" name="next" value="${esc(o.next)}">` : ""}
    ${o.user ? `<label>User name<input name="user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required autofocus></label>` : ""}
    <label>Password<input name="password" type="password" autocomplete="current-password" required${o.user ? "" : " autofocus"}></label>
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>
`;
}
