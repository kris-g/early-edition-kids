/**
 * Entry point: `tsx src/server.ts`. Two listeners in one process, sharing each profile's database:
 * PORT (8080) for the Kindle and DASHBOARD_PORT (8081) for the dashboard, both on HOST
 * (127.0.0.1 by default; 0.0.0.0 in the container).
 */

import type { Server } from "node:http";
import { createApp } from "./app.js";
import { generateAll } from "./profiles.js";
import { makeScheduler, parseGenerateAt } from "./schedule.js";

const earlyEditionKids = createApp();
const { host, port, dashboardPort } = earlyEditionKids.ctx.settings;

const servers: Server[] = [
  earlyEditionKids.kindleApp.listen(port, host, () => console.log(`Kindle API on http://${host}:${port}`)),
  earlyEditionKids.dashboardApp.listen(dashboardPort, host, () => console.log(`dashboard on http://${host}:${dashboardPort}/dashboard/`)),
];
// Optional built-in daily run (GENERATE_AT), for a plain docker run with no CronJob.
let stopSchedule = () => {};
try {
  const at = parseGenerateAt(earlyEditionKids.ctx.settings.generateAt);
  if (at !== null) {
    // Every profile in turn; a failure in any is retried (the others then return "exists").
    const run = async (date: string, now: Date) => {
      const results = await generateAll(earlyEditionKids.profiles, date, now);
      const statuses = [...results.values()].map((r) => r.status);
      return { status: statuses.includes("failed") ? "failed" : statuses.includes("created") ? "created" : "exists" };
    };
    stopSchedule = makeScheduler({ at, run }).start();
    console.log(`schedule: today's issue is made daily from ${earlyEditionKids.ctx.settings.generateAt} London time`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

for (const s of servers) {
  s.on("error", (err) => {
    console.error(`cannot listen: ${err.message}`);
    process.exit(1);
  });
}

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  stopSchedule();
  let open = servers.length;
  const done = () => {
    earlyEditionKids.close();
    process.exit(0);
  };
  for (const s of servers) s.close(() => --open === 0 && done());
  // A generation run may be in flight; do not hang forever.
  setTimeout(done, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
