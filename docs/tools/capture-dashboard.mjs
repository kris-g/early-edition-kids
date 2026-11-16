// Captures the dashboard pages that annotate.mjs draws on: 1440 px wide, 2x, light theme,
// in headless Chrome, driven over the DevTools protocol (no extra packages).
//
// Run the dashboard against its mock data first (in web/: `npm run mock`, and Vite pointed at it),
// then:
//   node docs/tools/capture-dashboard.mjs http://localhost:5173/dashboard/ /path/to/captures
//   node docs/tools/annotate.mjs /path/to/captures
//
// CHROME overrides the browser binary (default: Google Chrome in /Applications).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [BASE, OUT] = process.argv.slice(2);
if (!BASE || !OUT) {
  console.error("Usage: node docs/tools/capture-dashboard.mjs <dashboard URL> <captures folder>");
  process.exit(1);
}
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1440;
const SCALE = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each page: its path under the dashboard, and anything to do before the shot.
const PAGES = [
  { file: "overview", path: "" },
  { file: "reading", path: "reading" },
  { file: "calendar", path: "calendar" },
  { file: "find", path: "find" },
  { file: "ai", path: "ai" },
  {
    // Science pinned, Weather off, and Details open on Football. Each click waits for the mock to answer,
    // and only happens if needed, so running this again leaves the mock the same.
    file: "topics",
    path: "topics",
    prepare: `(async () => {
      const wait = () => new Promise((r) => setTimeout(r, 600));
      const pin = document.querySelector('button[aria-label="Pin Science"]');
      if (pin?.getAttribute('aria-pressed') !== 'true') { pin?.click(); await wait(); }
      const sw = document.querySelector('button[aria-label="Weather in the paper"]');
      if (sw?.getAttribute('aria-checked') !== 'false') { sw?.click(); await wait(); }
      document.querySelector('section[aria-label="Football"] button[aria-expanded="false"]')?.click();
      await wait();
      return true;
    })()`,
  },
  {
    // Mock story 1711 has number and word marks; open the note on its second number check.
    // Opened after the resize, since a new width closes the note.
    file: "story",
    path: "story/1711",
    after: `document.querySelectorAll('mark[data-check="number"]')[1]?.click()`,
  },
];

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "eek-capture-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  `--window-size=${WIDTH},900`,
  "about:blank",
], { stdio: "ignore" });

let port;
for (let i = 0; i < 100 && !port; i++) {
  const f = join(profile, "DevToolsActivePort");
  if (existsSync(f)) port = readFileSync(f, "utf8").split("\n")[0];
  else await sleep(100);
}
if (!port) throw new Error("Chrome did not start");

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 900, deviceScaleFactor: SCALE, mobile: false });

for (const p of PAGES) {
  await send("Page.navigate", { url: new URL(p.path, BASE).href });
  // Wait for the page's data: no loading text and the fonts in.
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    const ready = await evaluate(`document.readyState === 'complete' && !!document.querySelector('main h1') && !/Loading/.test(document.querySelector('main')?.innerText ?? '')`);
    if (ready) break;
  }
  await evaluate(`document.fonts.ready.then(() => true)`);
  if (p.prepare) {
    await evaluate(p.prepare);
    await sleep(400);
  }
  await sleep(600); // charts animate in
  const height = await evaluate(`Math.ceil(document.documentElement.scrollHeight)`);
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height, deviceScaleFactor: SCALE, mobile: false });
  await sleep(500);
  if (p.after) {
    await evaluate(p.after);
    await sleep(400);
  }
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${p.file}.png`), Buffer.from(data, "base64"));
  console.log(`${p.file}.png ${WIDTH}x${height} CSS px`);
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 900, deviceScaleFactor: SCALE, mobile: false });
}

ws.close();
chrome.kill();
await sleep(300);
rmSync(profile, { recursive: true, force: true });
