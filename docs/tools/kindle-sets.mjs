// Builds the Kindle feature sets: a row of Kindle screens in Paperwhite frames, with a title,
// as one picture for posts and the promo site. Screens come from the plugin's screenshot tour in
// the KOReader emulator (plugin/.../tour.lua), run on the sample papers (docs/tools/sample-paper.mts).
//
// Usage, from the repository root (Chrome draws it, so outside any sandbox):
//   node docs/tools/kindle-sets.mjs --paper <tour shots> --closed <tour shots> --open <tour shots>
//
//   --paper   a run with Sport off, run twice on one home so a story shows as read
//   --closed  a run with Sport on and its lock on (the closed tile and screen)
//   --open    a run with Sport on and no lock (Matches, the table, a match)
//
// Writes docs/images/kindle/set-paper.png and set-sport.png (2x), and the same as .webp for the site.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = path.join(ROOT, "docs/images/kindle");
const require = createRequire(path.join(ROOT, "web/package.json"));
const sharp = require("sharp");

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const dirs = { paper: arg("paper"), closed: arg("closed"), open: arg("open") };

const SETS = [
  {
    name: "set-paper",
    title: "Early Edition: a daily kids' newspaper in KOReader",
    subtitle: "Kindle Paperwhite 3 · front page, today's paper, end of a story, back issues",
    screens: [
      ["paper", "1-front-page.png", "Front page"],
      ["paper", "2-todays-paper.png", "Today's paper"],
      ["paper", "3-story-finished.png", "End of a story"],
      ["paper", "4-back-issues.png", "Back issues"],
    ],
  },
  {
    name: "set-sport",
    title: "Sport: the football, once the news is read",
    subtitle: "Kindle Paperwhite 3 · the Sport tile, closed until today's stories are read, results, the table, a match",
    screens: [
      ["closed", "6-sport-front-page.png", "The Sport tile"],
      ["closed", "6-sport-closed.png", "Closed until the news is read"],
      ["open", "6-sport-matches.png", "The latest results"],
      ["open", "6-sport-table-1.png", "The table, your club first"],
      ["open", "6-sport-match.png", "A match"],
    ],
  },
];

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
if (!CHROME) throw new Error("Chrome not found");
const font = (pkg, file) => pathToFileURL(path.join(ROOT, "reader/node_modules/@fontsource", pkg, "files", file)).href;

// CSS pixels; drawn at 2x.
const SCREEN_W = 330;
const SCREEN_H = Math.round((SCREEN_W * 1448) / 1072);
const BEZEL = 15;
const CHIN = 36;
const GAP = 24;
const PAD = 22;
const DEVICE_W = SCREEN_W + 2 * BEZEL;
const HEAD = 96;

function html(set) {
  const width = 2 * PAD + set.screens.length * DEVICE_W + (set.screens.length - 1) * GAP;
  const height = HEAD + BEZEL + SCREEN_H + CHIN + 2 * PAD - 6;
  const devices = set.screens
    .map(([key, file, label]) => {
      const src = path.join(dirs[key], file);
      if (!existsSync(src)) throw new Error(`missing ${src} (--${key})`);
      return `<figure><div class="device"><img src="${pathToFileURL(src).href}" alt=""></div><figcaption>${label}</figcaption></figure>`;
    })
    .join("");
  return {
    width,
    height: height + 34,
    page: `<!doctype html><meta charset="utf-8"><style>
      @font-face { font-family: Serif; font-weight: 700; src: url(${font("noto-serif", "noto-serif-latin-700-normal.woff2")}); }
      @font-face { font-family: Sans; font-weight: 400; src: url(${font("noto-sans", "noto-sans-latin-400-normal.woff2")}); }
      @font-face { font-family: Sans; font-weight: 700; src: url(${font("noto-sans", "noto-sans-latin-700-normal.woff2")}); }
      html, body { margin: 0; background: #f2f0eb; color: #121212; }
      body { width: ${width}px; height: ${height + 34}px; padding: ${PAD - 6}px ${PAD}px 0; box-sizing: border-box; }
      h1 { font: 700 30px/1.15 Serif; text-align: center; margin: 4px 0 6px; letter-spacing: -0.005em; }
      p { font: 400 15px/1.3 Sans; color: #55554f; text-align: center; margin: 0 0 20px; }
      .row { display: flex; gap: ${GAP}px; }
      figure { margin: 0; }
      .device { width: ${SCREEN_W}px; padding: ${BEZEL}px ${BEZEL}px ${CHIN}px; background: #232323; border-radius: 20px; }
      .device img { display: block; width: ${SCREEN_W}px; height: ${SCREEN_H}px; }
      figcaption { font: 700 14px/1 Sans; text-align: center; margin-top: 12px; color: #33332f; }
    </style><h1>${set.title}</h1><p>${set.subtitle}</p><div class="row">${devices}</div>`,
  };
}

const tmp = mkdtempSync(path.join(tmpdir(), "kindle-sets-"));
try {
  for (const set of SETS) {
    if (!set.screens.every(([key]) => dirs[key])) {
      console.log(`skipped ${set.name}: needs ${[...new Set(set.screens.map(([k]) => `--${k}`))].join(" ")}`);
      continue;
    }
    const { width, height, page } = html(set);
    const file = path.join(tmp, `${set.name}.html`);
    writeFileSync(file, page);
    const png = path.join(OUT, `${set.name}.png`);
    execFileSync(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
      `--user-data-dir=${path.join(tmp, "chrome")}`, "--force-device-scale-factor=2",
      `--window-size=${width},${height}`, "--virtual-time-budget=4000", `--screenshot=${png}`, pathToFileURL(file).href,
    ], { stdio: "ignore" });
    await sharp(readFileSync(png)).webp({ quality: 88 }).toFile(path.join(OUT, `${set.name}.webp`));
    const meta = await sharp(png).metadata();
    console.log(`${set.name}: ${meta.width} x ${meta.height}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
