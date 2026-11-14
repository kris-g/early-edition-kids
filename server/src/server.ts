/**
 * Entry point: `tsx src/server.ts`. Two listeners in one process, sharing the database:
 * PORT (8080) for the Kindle and DASHBOARD_PORT (8081) for the dashboard, both on HOST
 * (127.0.0.1 by default; 0.0.0.0 in the container).
 */

import type { Server } from "node:http";
import { createApp } from "./app.js";

const earlyEditionKids = createApp();
const { host, port, dashboardPort } = earlyEditionKids.ctx.settings;

const servers: Server[] = [
  earlyEditionKids.kindleApp.listen(port, host, () => console.log(`Kindle API on http://${host}:${port}`)),
  earlyEditionKids.dashboardApp.listen(dashboardPort, host, () => console.log(`dashboard on http://${host}:${dashboardPort}/dashboard/`)),
];
for (const s of servers) {
  s.on("error", (err) => {
    console.error(`cannot listen: ${err.message}`);
    process.exit(1);
  });
}

function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
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
