// Draws numbered callouts onto the iPad setup screenshots for docs/ipad.md.
// The explanations for each number are in the page's text, not in the image.
//
// Captures (2x, as the Simulator and a 2x browser save them):
//   card.png      the dashboard's Devices page, 1440 px wide (headless Chrome, light theme)
//   1-safari.png  the reader open in Safari            (xcrun simctl io booted screenshot)
//   2-share.png   the Share menu
//   3-more.png    the Share menu after View More
//   4-add.png     the Add to Home Screen sheet
//   5-home.png    the home screen with the new icon
//   6-front.png   the reader opened from its icon
//   8-curl.png    a page halfway through turning (a frame from a screen recording)
//   9-finished.png the end of a story
// Boxes are in points (CSS pixels); the captures are 2x.
// Usage: node docs/tools/annotate-ipad.mjs <captures folder>
import { createRequire } from "node:module";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const sharp = require("sharp");

const IN = process.argv[2];
if (!IN) { console.error("Usage: node docs/tools/annotate-ipad.mjs <captures folder>"); process.exit(1); }
const OUT = new URL("../images/ipad/", import.meta.url).pathname;
const S = 2;
const ACCENT = "#C2410C";

// crop: [left, top, width, height] in points; width: output width in pixels.
// notes: [left, top, width, height, place?], where place "right" puts the badge top-right.
const shots = [
  {
    in: "card", out: "dashboard-card", crop: [270, 463, 1140, 302], width: 1600,
    notes: [[301, 538, 184, 184], [507, 556, 874, 48, "right"], [507, 610, 874, 96, "right"]],
  },
  {
    in: "1-safari", out: "1-open-in-safari", crop: [0, 0, 820, 640], width: 1100,
    notes: [[230, 30, 362, 48], [676, 30, 48, 48]],
  },
  {
    in: "2-share", out: "2-view-more", crop: [340, 0, 480, 480], width: 800,
    notes: [[704, 338, 74, 98]],
  },
  {
    in: "3-more", out: "3-add-to-home-screen", crop: [340, 330, 480, 500], width: 800,
    notes: [[448, 622, 340, 50]],
  },
  {
    in: "4-add", out: "4-name-and-add", crop: [0, 0, 820, 420], width: 1100,
    notes: [[128, 180, 584, 90], [118, 314, 584, 54], [622, 108, 71, 51]],
  },
  {
    in: "5-home", out: "5-home-screen", crop: [0, 0, 820, 400], width: 1100,
    notes: [[370, 250, 80, 98]],
  },
  {
    in: "6-front", out: "6-front-page", crop: [0, 0, 820, 1180], width: 1100,
    notes: [[320, 46, 182, 32], [36, 785, 391, 74], [442, 792, 252, 56], [420, 1074, 364, 68]],
  },
  {
    in: "8-curl", out: "7-turning-a-page", crop: [0, 0, 820, 1180], width: 1100,
    notes: [[560, 600, 252, 470], [584, 1085, 200, 67], [338, 1100, 144, 36], [550, 48, 220, 30], [52, 46, 132, 34]],
  },
  {
    in: "9-finished", out: "8-story-finished", crop: [0, 0, 820, 1180], width: 1100,
    notes: [[52, 122, 659, 122], [52, 893, 524, 138], [52, 1040, 717, 100]],
  },
];

for (const s of shots) {
  const [cl, ct, cw, ch] = s.crop.map((v) => v * S);
  const shot = await sharp(`${IN}/${s.in}.png`).extract({ left: cl, top: ct, width: cw, height: ch }).toBuffer();
  let ov = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}">`;
  s.notes.forEach(([x, y, w, h, place], i) => {
    const X = x * S - cl, Y = y * S - ct, W = w * S, H = h * S;
    ov += `<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="18" fill="none" stroke="#fff" stroke-width="14" opacity="0.85"/>`;
    ov += `<rect x="${X}" y="${Y}" width="${W}" height="${H}" rx="18" fill="none" stroke="${ACCENT}" stroke-width="7" stroke-dasharray="22 12"/>`;
    // Badge on the top-right corner when the note asks ("right"), beside a short box (so it
    // doesn't cover the label), else on the top-left corner; always kept inside the image.
    const r = 40;
    const beside = place !== "right" && H < 140 && X > 2 * r + 24;
    const corner = place === "right" ? X + W : X;
    const cx = beside ? X - r - 14 : Math.min(cw - r - 6, Math.max(r + 6, corner));
    const cy = beside ? Y + H / 2 : Math.min(ch - r - 6, Math.max(r + 6, Y));
    ov += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ACCENT}" stroke="#fff" stroke-width="7"/>`;
    ov += `<text x="${cx}" y="${cy + 17}" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="48" font-weight="700" fill="#fff">${i + 1}</text>`;
  });
  ov += `</svg>`;
  const scale = s.width / cw;
  // sharp resizes before it composites, so draw the callouts first.
  const drawn = await sharp(shot).composite([{ input: Buffer.from(ov), left: 0, top: 0 }]).png().toBuffer();
  await sharp(drawn)
    .resize({ width: s.width, height: Math.round(ch * scale) })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(`${OUT}${s.out}.jpg`);
  console.log(`${s.out}.jpg ${s.width}x${Math.round(ch * scale)} (${s.notes.length} notes)`);
}
