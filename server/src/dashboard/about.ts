/**
 * GET /api/dashboard/about (CONTRACT.md "About this server"): what the server is and where it runs,
 * for the dashboard's Devices page. It is about the process, so it is the same for every profile.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AboutView } from "./types.js";

/** server/package.json: two folders up from here, in the repo and in the container (/app/package.json). */
const PACKAGE_JSON = fileURLToPath(new URL("../../package.json", import.meta.url));

let cachedVersion: string | null = null;

export function serverVersion(): string {
  if (cachedVersion === null) {
    try {
      const v = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).version;
      cachedVersion = typeof v === "string" && v ? v : "unknown";
    } catch {
      cachedVersion = "unknown";
    }
  }
  return cachedVersion;
}

export interface AboutProbe {
  env: Record<string, string | undefined>;
  /** Whether a file exists; only asked about /.dockerenv. */
  exists: (file: string) => boolean;
  uptime: () => number;
}

const realProbe: AboutProbe = { env: process.env, exists: existsSync, uptime: () => process.uptime() };

/** Kubernetes sets KUBERNETES_SERVICE_HOST in every pod; Docker leaves /.dockerenv in the container. */
export function containerKind(probe: Pick<AboutProbe, "env" | "exists">): AboutView["container"] {
  if (probe.env.KUBERNETES_SERVICE_HOST) return "kubernetes";
  if (probe.exists("/.dockerenv")) return "docker";
  return null;
}

export function aboutView(probe: AboutProbe = realProbe): AboutView {
  return {
    version: serverVersion(),
    arch: process.arch,
    platform: process.platform,
    container: containerKind(probe),
    uptime_seconds: Math.max(0, Math.floor(probe.uptime())),
  };
}
