import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { parseProfiles } from "../src/config.js";
import { aboutView, containerKind } from "../src/dashboard/about.js";
import { exampleConfigData, makeApp, SERVER_DIR, type TestApp } from "./helpers.js";

let t: TestApp;
afterEach(() => t?.cleanup());

const VERSION = JSON.parse(readFileSync(path.join(SERVER_DIR, "package.json"), "utf8")).version;

describe("GET /api/dashboard/about", () => {
  it("says what the server is and where it runs", async () => {
    t = makeApp();
    const r = await t.agent.get("/api/dashboard/about");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(r.body).sort()).toEqual(["arch", "container", "platform", "uptime_seconds", "version"]);
    expect(r.body.version).toBe(VERSION);
    expect(r.body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.body.arch).toBe(process.arch);
    expect(r.body.platform).toBe(process.platform);
    expect([null, "docker", "kubernetes"]).toContain(r.body.container);
    expect(Number.isInteger(r.body.uptime_seconds)).toBe(true);
    expect(r.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it("is about the server, so it is not under a profile and not on the Kindle port", async () => {
    t = makeApp({ profiles: parseProfiles({ ...exampleConfigData(), profiles: [{ id: "older" }, { id: "younger" }] }) });
    expect((await t.agent.get("/api/dashboard/about")).status).toBe(200);
    expect((await t.agent.get("/api/dashboard/p/younger/about")).status).toBe(404);
    expect((await request(t.kindleApp).get("/api/dashboard/about")).status).toBe(404);
  });

  it("needs a session when the built-in sign-in is on", async () => {
    t = makeApp({ settings: { dashboardPassword: "open sesame" } });
    expect((await t.agent.get("/api/dashboard/about")).status).toBe(401);
  });
});

describe("where the server runs", () => {
  const probe = (env: Record<string, string>, dockerenv: boolean) => ({ env, exists: (f: string) => dockerenv && f === "/.dockerenv" });

  it("is Kubernetes with KUBERNETES_SERVICE_HOST, Docker with /.dockerenv, else neither", () => {
    expect(containerKind(probe({ KUBERNETES_SERVICE_HOST: "10.43.0.1" }, false))).toBe("kubernetes");
    expect(containerKind(probe({}, true))).toBe("docker");
    expect(containerKind(probe({}, false))).toBeNull();
    // A pod's container can have /.dockerenv too; Kubernetes is the more useful answer.
    expect(containerKind(probe({ KUBERNETES_SERVICE_HOST: "10.43.0.1" }, true))).toBe("kubernetes");
  });

  it("reports uptime in whole seconds", () => {
    const view = aboutView({ env: {}, exists: () => false, uptime: () => 93784.6 });
    expect(view.uptime_seconds).toBe(93784);
    expect(view.container).toBeNull();
  });
});
