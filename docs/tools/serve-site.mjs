// Serves the promo site in site/ as plain files, the way GitHub Pages does, for a local preview.
// Usage, from the repo root: node docs/tools/serve-site.mjs [port]   (default 4321)
// A bundler's dev server is no good here: the site's scripts load each other by relative path.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../site", import.meta.url)));
const port = Number(process.argv[2] ?? 4321);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
};

createServer((req, res) => {
  let file = join(root, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
  let stat;
  try {
    stat = statSync(file);
    if (stat.isDirectory()) stat = statSync((file = join(file, "index.html")));
  } catch {
    return res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
  const headers = {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
    "accept-ranges": "bytes",
  };
  // Range requests, so the film can be scrubbed.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end) return res.writeHead(416, { "content-range": `bytes */${stat.size}` }).end();
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": stat.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Promo site on http://localhost:${port}`));
