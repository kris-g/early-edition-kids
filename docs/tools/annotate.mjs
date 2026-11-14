// Draws numbered callouts and a key onto the dashboard screenshots.
// Boxes are in CSS pixels at 1440px wide; the captures are 2x.
// Usage: node docs/tools/annotate.mjs <folder holding overview.png, reading.png, calendar.png, ai.png, find.png>
import { createRequire } from "node:module";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const sharp = require("sharp");

const IN = process.argv[2];
if (!IN) { console.error("Usage: node docs/tools/annotate.mjs <captures folder>"); process.exit(1); }
const OUT = new URL("../images/dashboard/", import.meta.url).pathname;
const S = 2;               // capture scale
const KEY_W = 560 * S;     // key panel width
const ACCENT = "#C2410C";

const pages = [
  {
    file: "overview", title: "Overview", sub: "The laptop home page: everything at a glance", crop: 1189,
    notes: [
      [[16, 90, 207, 284], "Pages", "Overview, Reading, Calendar, Find articles, Topics and AI. On a phone these become tabs along the bottom."],
      [[16, 1116, 207, 48], "Light or dark", "Follows your device until you flip it, then remembers your choice."],
      [[972, 50, 426, 44], "Today's actions", "When the paper reached the Kindle, Make it again to redo today's paper, and Add an article."],
      [[282, 114, 405, 351], "Reading streak", "Days in a row with at least one story read to the end, and the last 14 days. An outlined square is a missed day."],
      [[707, 114, 691, 351], "Stories per day", "Stories read each day with the average line. Switch between 14 days, 30 days and 12 weeks. Hover a bar for the exact numbers."],
      [[282, 485, 365, 578], "This month", "Each day's number is stories read; darker means more. Today is outlined."],
      [[667, 485, 345, 578], "AI and cost", "Which model wrote today's paper, spend this month against your limit, and cost per day."],
      [[1033, 485, 365, 578], "Today's paper", "Each story's status: read (with reading time), opened, or not yet. The eye button hides a story from the Kindle."],
      [[282, 1083, 1116, 66], "This morning's run", "When the paper was made, by which model, how long it took, what it cost and how many stories the checker sent back."],
    ],
  },
  {
    file: "reading", title: "Reading", sub: "How much he reads, and what", crop: 957,
    notes: [
      [[282, 126, 262, 44], "Time range", "Look back 14 days, 30 days or 12 weeks."],
      [[282, 186, 550, 283], "Streak", "Days in a row now and the longest so far, with dates, above the day-by-day strip."],
      [[848, 186, 550, 283], "Stories per day", "One bar per day with the average. Hover or tap a bar for the date, stories read and minutes."],
      [[282, 485, 550, 432], "Time reading", "Minutes of actual reading each day. Time with the Kindle asleep isn't counted."],
      [[848, 485, 550, 432], "What he reads", "Stories read out of those in his papers, by topic. Manage topics pins or blocks a topic."],
    ],
  },
  {
    file: "calendar", title: "Calendar", sub: "A month of reading, day by day", crop: 900,
    notes: [
      [[1302, 28, 96, 44], "Change month", "Step back through earlier months."],
      [[282, 104, 600, 432], "The month", "Each day shows stories read, shaded for 0, 1 to 2, 3 to 4 and 5 to 6. Future days are dashed and today is outlined. Tap a day to see it."],
      [[898, 104, 500, 432], "The chosen day", "That day's stories and whether he read them, with a link to the day's paper."],
      [[282, 554, 600, 70], "Month totals", "Stories read this month, how many days he read, and days he read the whole paper."],
    ],
  },
  {
    file: "ai", title: "AI", sub: "Who writes and checks the paper, and what it costs", crop: 1384,
    notes: [
      [[282, 126, 550, 76], "This morning", "Whether today's paper went out, when, how long it took, how many AI calls and the cost."],
      [[282, 218, 550, 652], "Who writes", "Choose the writer from Anthropic or OpenRouter, each with an estimated cost a day."],
      [[282, 886, 550, 285], "Who checks", "The model that checks every story for facts and safety, and how hard it thinks."],
      [[282, 1186, 550, 158], "Your choices", "Daily and monthly cost of what you've picked. Changes start with tomorrow's paper."],
      [[848, 126, 550, 484], "Cost this month", "Spend so far against the monthly limit (set or remove it here), the month's projection, and cost per day."],
      [[848, 625, 550, 280], "Where it goes", "A day's cost split into choosing, writing and checking, and how much text the AI read and wrote."],
      [[848, 921, 550, 182], "Quality", "Stories sent back by the checker, stories the AI declined, papers ready before 7 am, and average time."],
      [[848, 1119, 550, 189], "Accounts", "Which AI accounts are connected and when each was last used. Keys stay on the server."],
    ],
  },
  {
    file: "find", title: "Find articles", sub: "Add a story to his paper yourself", crop: 1400,
    notes: [
      [[282, 184, 1116, 48], "Search or paste", "Search the last 30 days of news from the paper's sources, or paste a link to any article."],
      [[301, 423, 248, 44], "Add it", "Add to today's paper or tomorrow's. It's rewritten for him and safety-checked first; if it fails you see why."],
    ],
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
function wrap(text, max) {
  const words = text.split(" "); const lines = []; let line = "";
  for (const w of words) { if ((line + " " + w).trim().length > max) { lines.push(line.trim()); line = w; } else line += " " + w; }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

for (const p of pages) {
  const shot = sharp(`${IN}/${p.file}.png`);
  const meta = await shot.metadata();
  const H = Math.min(meta.height, p.crop * S);
  const W = meta.width;
  // Overlay on the screenshot: boxes and numbered badges.
  let ov = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  p.notes.forEach(([[x, y, w, h]], i) => {
    const X = x * S, Y = y * S, Wd = w * S, Hd = h * S, n = i + 1;
    ov += `<rect x="${X - 6}" y="${Y - 6}" width="${Wd + 12}" height="${Hd + 12}" rx="22" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-dasharray="20 12"/>`;
    const cx = Math.max(40, X - 6), cy = Math.max(40, Y - 6);
    ov += `<circle cx="${cx}" cy="${cy}" r="34" fill="${ACCENT}" stroke="#fff" stroke-width="6"/>`;
    ov += `<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="42" font-weight="700" fill="#fff">${n}</text>`;
  });
  ov += `</svg>`;

  // Key panel on the right.
  const pad = 56 * S / 2;
  let ky = 120;
  let key = `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_W}" height="${H}"><rect width="${KEY_W}" height="${H}" fill="#FFFFFF"/><rect width="4" height="${H}" fill="#E2DFD6"/>`;
  key += `<text x="${pad}" y="${ky}" font-family="Georgia, serif" font-size="68" font-weight="700" fill="#171717">${esc(p.title)}</text>`;
  ky += 64;
  for (const l of wrap(p.sub, 44)) { key += `<text x="${pad}" y="${ky}" font-family="Helvetica Neue, Arial, sans-serif" font-size="32" fill="#5F5E5A">${esc(l)}</text>`; ky += 44; }
  ky += 40;
  p.notes.forEach(([, title, body], i) => {
    const n = i + 1;
    key += `<circle cx="${pad + 30}" cy="${ky - 10}" r="30" fill="${ACCENT}"/><text x="${pad + 30}" y="${ky + 4}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="36" font-weight="700" fill="#fff">${n}</text>`;
    key += `<text x="${pad + 84}" y="${ky + 2}" font-family="Helvetica Neue, Arial, sans-serif" font-size="36" font-weight="700" fill="#171717">${esc(title)}</text>`;
    ky += 50;
    for (const l of wrap(body, 46)) { key += `<text x="${pad + 84}" y="${ky}" font-family="Helvetica Neue, Arial, sans-serif" font-size="30" fill="#3A3A38">${esc(l)}</text>`; ky += 42; }
    ky += 36;
  });
  key += `<text x="${pad}" y="${H - 50}" font-family="Helvetica Neue, Arial, sans-serif" font-size="26" fill="#5F5E5A">Sample data · laptop width (1440 px) · light theme</text>`;
  key += `</svg>`;

  const keyH = Math.max(H, ky + 100);
  const canvasH = Math.max(H, keyH);
  await sharp({ create: { width: W + KEY_W, height: canvasH, channels: 3, background: "#F4F2EC" } })
    .composite([
      { input: await shot.extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer(), left: 0, top: 0 },
      { input: Buffer.from(ov), left: 0, top: 0 },
      { input: Buffer.from(key.replace(`height="${H}"`, `height="${canvasH}"`).replace(`height="${H}" fill="#FFFFFF"`, `height="${canvasH}" fill="#FFFFFF"`)), left: W, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}${p.file}.png`);
  console.log(`${p.file}.png ${W + KEY_W}x${canvasH} (${p.notes.length} notes, key ends at ${ky})`);
}
