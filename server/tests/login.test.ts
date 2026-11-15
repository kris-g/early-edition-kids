import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardLogin, SESSION_COOKIE, safeNext } from "../src/dashboard/login.js";
import { Clock, makeApp, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const cookieOf = (r: request.Response) => {
  const set = ([] as string[]).concat(r.headers["set-cookie"] ?? []);
  return set.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? null;
};

const signIn = (password = "hunter2", extra: Record<string, string> = {}) =>
  request(t.dashboardApp).post("/login").type("form").send({ password, ...extra });

describe("dashboard without DASHBOARD_PASSWORD", () => {
  it("has no login at all", async () => {
    t = makeApp();
    expect((await request(t.dashboardApp).get("/api/dashboard/summary")).status).toBe(200);
    expect((await request(t.dashboardApp).get("/login")).status).toBe(404);
    expect((await request(t.dashboardApp).get("/api/dashboard/profiles")).body.login).toBe(false);
  });
});

describe("dashboard with DASHBOARD_PASSWORD", () => {
  it("asks for a session everywhere but /healthz and the sign-in routes", async () => {
    t = makeApp({ settings: { dashboardPassword: "hunter2" } });
    const app = request(t.dashboardApp);
    expect((await app.get("/healthz")).status).toBe(200);
    const api = await app.get("/api/dashboard/summary");
    expect(api.status).toBe(401);
    expect(api.body.error).toBeTruthy();
    expect((await app.post("/api/dashboard/regenerate").set("X-Early-Edition", "1")).status).toBe(401);
    const page = await app.get("/dashboard/reading?days=7");
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe(`/login?next=${encodeURIComponent("/dashboard/reading?days=7")}`);
    expect((await app.get("/")).headers.location).toBe("/login");
    const form = await app.get("/login?next=/dashboard/calendar");
    expect(form.status).toBe(200);
    expect(form.headers["content-type"]).toMatch(/text\/html/);
    expect(form.text).toContain('type="password"');
    expect(form.text).toContain('name="next" value="/dashboard/calendar"');
    expect(form.text).not.toContain('name="user"');
    // The Kindle port is untouched.
    expect((await request(t.app).get("/healthz")).status).toBe(200);
    expect((await request(t.app).get("/api/issue/today")).status).toBe(404);
  });

  it("signs in with the password and sets a 30-day HttpOnly cookie", async () => {
    t = makeApp({ settings: { dashboardPassword: "hunter2" } });
    const r = await signIn("hunter2", { next: "/dashboard/ai" });
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe("/dashboard/ai");
    const cookie = cookieOf(r)!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).not.toMatch(/Secure/);
    const value = cookie.split(";")[0];
    const ok = await request(t.dashboardApp).get("/api/dashboard/summary").set("Cookie", value);
    expect(ok.status).toBe(200);
    expect((await request(t.dashboardApp).get("/api/dashboard/profiles").set("Cookie", value)).body.login).toBe(true);
    // Already signed in: /login goes straight on.
    expect((await request(t.dashboardApp).get("/login").set("Cookie", value)).headers.location).toBe("/dashboard/");
    // Tampered cookies are refused.
    const bad = value.slice(0, -2) + (value.endsWith("AA") ? "BB" : "AA");
    expect((await request(t.dashboardApp).get("/api/dashboard/summary").set("Cookie", bad)).status).toBe(401);
  });

  it("marks the cookie Secure behind an https proxy", async () => {
    t = makeApp({ settings: { dashboardPassword: "hunter2" } });
    const r = await request(t.dashboardApp).post("/login").set("X-Forwarded-Proto", "https").type("form").send({ password: "hunter2" });
    expect(cookieOf(r)).toMatch(/; Secure/);
  });

  it("asks for the user name when DASHBOARD_USER is set", async () => {
    t = makeApp({ settings: { dashboardPassword: "hunter2", dashboardUser: "parent" } });
    expect((await request(t.dashboardApp).get("/login")).text).toContain('name="user"');
    expect((await signIn("hunter2")).status).toBe(401);
    expect((await signIn("hunter2", { user: "someone" })).status).toBe(401);
    expect((await signIn("hunter2", { user: "parent" })).status).toBe(303);
  });

  it("refuses a wrong password and only accepts a next under /dashboard", async () => {
    t = makeApp({ settings: { dashboardPassword: "hunter2" } });
    const wrong = await signIn("nope", { next: "/dashboard/ai" });
    expect(wrong.status).toBe(401);
    expect(cookieOf(wrong)).toBeNull();
    expect(wrong.text).toContain("not right");
    for (const next of ["https://evil.example/", "//evil.example/dashboard", "/dashboardx", "/api/dashboard/summary", "/dashboard\\..\\x"]) {
      expect((await signIn("hunter2", { next })).headers.location).toBe("/dashboard/");
    }
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/dashboard/p/younger/day/2026-11-14?view=paper")).toBe("/dashboard/p/younger/day/2026-11-14?view=paper");
    expect(safeNext("/dashboard//evil.example")).toBeNull();
    expect(safeNext("/dashboard/%2F%2Fevil")).toBeNull();
  });

  it("limits failed sign-ins to five a minute per address", async () => {
    const clock = new Clock();
    t = makeApp({ settings: { dashboardPassword: "hunter2" }, clock });
    for (let i = 0; i < 5; i++) expect((await signIn("nope")).status).toBe(401);
    const blocked = await signIn("hunter2");
    expect(blocked.status).toBe(429);
    expect(cookieOf(blocked)).toBeNull();
    clock.now = new Date(clock.now.getTime() + 61_000);
    expect((await signIn("hunter2")).status).toBe(303);
  });

  it("signs out by clearing the cookie", async () => {
    t = makeApp({ settings: { dashboardPassword: "hunter2" } });
    const r = await request(t.dashboardApp).post("/logout");
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe("/login");
    expect(cookieOf(r)).toMatch(/^eek_session=;.*Max-Age=0/);
  });
});

describe("session cookies", () => {
  const login = (o: Partial<{ password: string; secret: string; user: string }> = {}, now = new Date("2026-11-14T00:00:00Z")) =>
    new DashboardLogin({ password: "hunter2", user: "", secret: "", ...o, clock: () => now });

  it("expire after 30 days", () => {
    const l = login();
    const v = l.issue();
    expect(l.verify(v, new Date("2026-12-13T23:00:00Z"))).toBe(true);
    expect(l.verify(v, new Date("2026-12-14T00:00:01Z"))).toBe(false);
  });

  it("stop working when the password or SESSION_SECRET changes", () => {
    const v = login().issue();
    expect(login().verify(v)).toBe(true);
    expect(login({ password: "other" }).verify(v)).toBe(false);
    expect(login({ secret: "s" }).verify(v)).toBe(false);
    expect(login().verify("v1.99999999999.abc")).toBe(false);
    expect(login().verify(undefined)).toBe(false);
  });
});
