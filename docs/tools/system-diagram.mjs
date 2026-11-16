// Draws the system overview as two SVGs, light and dark, for the README and docs/architecture.md.
// Usage: node docs/tools/system-diagram.mjs
// Edit the coordinates and text below, run it, and commit the two SVGs it writes.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../images/architecture/", import.meta.url);
const W = 1240, H = 760;
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const themes = {
  light: {
    bg: "#F4F2EC", panel: "#EAE6DA", panelStroke: "#CFCABB", pod: "#FBFAF6", card: "#FFFFFF",
    ink: "#171717", muted: "#5F5E5A", accent: "#C2410C", onAccent: "#FFFFFF",
    device: "#1F1F1D", deviceStroke: "#1F1F1D", screen: "#FBFAF6", screenInk: "#171717", screenSoft: "#9A978F",
    phoneScreen: "#FFFFFF", phoneInk: "#171717", phoneSoft: "#B9B6AD",
  },
  dark: {
    bg: "#151513", panel: "#1F1F1C", panelStroke: "#3D3C37", pod: "#191917", card: "#272723",
    ink: "#EDEAE2", muted: "#A8A59C", accent: "#F0803C", onAccent: "#151513",
    device: "#0A0A09", deviceStroke: "#6B6962", screen: "#E9E6DD", screenInk: "#171717", screenSoft: "#8E8B83",
    phoneScreen: "#1F1F1C", phoneInk: "#EDEAE2", phoneSoft: "#5C5A54",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function draw(c) {
  const out = [];
  const add = (s) => out.push(s);
  const text = (x, y, s, o = {}) => add(
    `<text x="${x}" y="${y}" font-family="${o.font ?? SANS}" font-size="${o.size ?? 14}"` +
    ` font-weight="${o.weight ?? 400}" fill="${o.fill ?? c.ink}" text-anchor="${o.anchor ?? "start"}"` +
    `${o.ls ? ` letter-spacing="${o.ls}"` : ""}${o.italic ? ` font-style="italic"` : ""}>${esc(s)}</text>`);
  const rect = (x, y, w, h, o = {}) => add(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 8}" fill="${o.fill ?? c.card}"` +
    ` stroke="${o.stroke ?? c.ink}" stroke-width="${o.sw ?? 1.5}"/>`);
  const path = (d, o = {}) => add(
    `<path d="${d}" fill="${o.fill ?? "none"}" stroke="${o.stroke ?? c.ink}" stroke-width="${o.sw ?? 1.6}"` +
    ` stroke-linecap="round" stroke-linejoin="round"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}` +
    `${o.end ? ` marker-end="url(#end-${o.end})"` : ""}${o.start ? ` marker-start="url(#start-${o.start})"` : ""}/>`);
  const badge = (x, y, n) => {
    add(`<circle cx="${x}" cy="${y}" r="11.5" fill="${c.accent}" stroke="${c.bg}" stroke-width="2"/>`);
    text(x, y + 4.5, n, { size: 13, weight: 700, fill: c.onAccent, anchor: "middle" });
  };

  // ---- Header: a small masthead ----
  path("M44,66 A14,14 0 0 1 72,66 Z", { fill: c.ink, sw: 0 });
  path("M36,66 H80", { sw: 2 });
  path("M58,42 V46 M39,53 L42,56 M77,53 L74,56 M47,45 L49,49 M69,45 L67,49", { sw: 1.8 });
  text(92, 67, "Early Edition Kids", { font: SERIF, size: 32, weight: 700 });
  text(1204, 47, "HOW IT FITS TOGETHER", { size: 12, weight: 700, fill: c.muted, anchor: "end", ls: 2 });
  text(1204, 69, "From the news feeds to a Kindle or an iPad, every morning", { font: SERIF, size: 15.5, italic: true, anchor: "end" });
  path("M36,82 H1204", { sw: 3 });
  path("M36,88 H1204", { sw: 1 });

  // ---- The cluster panel and the server pod ----
  rect(290, 110, 560, 540, { fill: c.panel, stroke: c.panelStroke, rx: 14 });
  text(312, 137, "HOME SERVER · DOCKER OR KUBERNETES", { size: 12, weight: 700, fill: c.muted, ls: 2 });
  rect(316, 240, 454, 320, { fill: c.pod, rx: 10 });
  text(752, 544, "SERVER · ONE CONTAINER", { size: 11.5, weight: 700, fill: c.muted, anchor: "end", ls: 1.6 });

  // The 05:30 CronJob.
  rect(340, 150, 222, 50, { rx: 25 });
  add(`<circle cx="367" cy="175" r="11" fill="none" stroke="${c.ink}" stroke-width="1.6"/>`);
  path("M367,168 V175 L372,178", { sw: 1.6 });
  text(388, 172, "05:30 every morning", { size: 14.5, weight: 700 });
  text(388, 189, "GENERATE_AT or a CronJob", { size: 12.5, fill: c.muted });
  path("M423,200 V274", { end: "ink" });
  text(434, 225, "make each reader's paper", { size: 13.5, fill: c.muted });

  // The pipeline's four steps.
  const steps = ["Fetch the feeds", "Select stories", "Rewrite for their age", "Check each one"];
  steps.forEach((label, i) => {
    const y = 282 + i * 56;
    rect(340, y, 166, 42, { rx: 6 });
    text(423, y + 26, label, { size: 14.5, weight: 600, anchor: "middle" });
    if (i < steps.length - 1) path(`M423,${y + 42} V${y + 53}`, { end: "small", sw: 1.4 });
  });
  text(423, 524, "about 13 AI calls a run", { size: 12.5, fill: c.muted, anchor: "middle" });

  // SQLite and the story files.
  path("M506,395 H544", { end: "ink" });
  path("M548,358 A45,10 0 0 1 638,358 V434 A45,10 0 0 1 548,434 Z", { fill: c.card, sw: 1.5 });
  path("M548,358 A45,10 0 0 0 638,358", { sw: 1.5 });
  text(593, 399, "SQLite", { size: 14, weight: 700, anchor: "middle" });
  text(593, 417, "stories, photos", { size: 12.5, fill: c.muted, anchor: "middle" });

  // The two ports.
  path("M638,382 C656,382 648,301 664,301", { end: "ink" });
  path("M638,410 C656,410 648,470 664,470", { end: "ink" });
  rect(668, 268, 88, 66, { rx: 6 });
  text(712, 297, "Reader API", { size: 14, weight: 700, anchor: "middle" });
  text(712, 316, "port 8080", { font: MONO, size: 12.5, fill: c.muted, anchor: "middle" });
  rect(668, 437, 88, 66, { rx: 6 });
  text(712, 466, "Dashboard", { size: 14, weight: 700, anchor: "middle" });
  text(712, 485, "port 8081", { font: MONO, size: 12.5, fill: c.muted, anchor: "middle" });

  // The nightly backup.
  path("M593,446 V578", { stroke: c.muted, dash: "5 5", end: "muted", sw: 1.4 });
  rect(493, 582, 200, 46, { rx: 23, stroke: c.muted, fill: c.panel });
  text(593, 610, "02:15 nightly backup", { size: 13.5, fill: c.muted, anchor: "middle" });
  path("M493,605 H240", { stroke: c.muted, dash: "5 5", end: "muted", sw: 1.4 });

  // ---- Left column: what comes in ----
  rect(36, 226, 200, 124);
  text(52, 252, "News feeds", { size: 15, weight: 700 });
  ["BBC Newsround", "BBC Sport", "BBC science", "Science News Explores"].forEach((s, i) =>
    text(52, 275 + i * 19, s, { size: 13.5, fill: c.muted }));
  path("M236,303 H336", { end: "ink" });

  rect(36, 373, 200, 84);
  text(52, 399, "AI models", { size: 15, weight: 700 });
  text(52, 420, "Anthropic API", { size: 13.5, fill: c.muted });
  text(52, 439, "or OpenRouter", { size: 13.5, fill: c.muted });
  path("M340,359 H328 V471 H340 M328,415 H340", { sw: 1.4 });
  path("M241,415 H323", { end: "ink", start: "ink" });

  rect(36, 577, 200, 56, { stroke: c.muted });
  text(52, 601, "NAS", { size: 15, weight: 700 });
  text(52, 620, "30 days of backups", { size: 13.5, fill: c.muted });

  // ---- Right column: the readers, a Kindle and an iPad, one outline round both ----
  path("M756,288 H901", { end: "ink" });
  path("M906,314 H761", { end: "ink" });
  text(838, 279, "today's paper", { size: 13.5, anchor: "middle" });
  text(836, 337, "what was read", { size: 13.5, anchor: "middle" });
  rect(906, 112, 298, 244, { fill: "none", stroke: c.panelStroke, rx: 14 });

  // The iPad: the reader's front page, a lead photo and the headlines.
  rect(1062, 128, 128, 171, { fill: c.device, stroke: c.deviceStroke, rx: 12 });
  rect(1069, 135, 114, 157, { fill: c.screen, stroke: c.screen, rx: 4, sw: 0 });
  text(1126, 153, "Early Edition", { font: SERIF, size: 12.5, weight: 700, fill: c.screenInk, anchor: "middle" });
  path("M1076,158 H1176", { stroke: c.screenInk, sw: 1.2 });
  path("M1076,161 H1176", { stroke: c.screenInk, sw: 0.5 });
  add(`<rect x="1076" y="167" width="100" height="44" rx="2" fill="${c.screenSoft}"/>`);
  add(`<rect x="1076" y="218" width="94" height="5" rx="1" fill="${c.screenInk}"/>`);
  add(`<rect x="1076" y="227" width="68" height="5" rx="1" fill="${c.screenInk}"/>`);
  [244, 260, 276].forEach((y, i) => {
    path(`M1076,${y - 6} H1176`, { stroke: c.screenSoft, sw: 0.5 });
    add(`<rect x="1076" y="${y}" width="${[86, 74, 80][i]}" height="4" rx="1" fill="${c.screenInk}"/>`);
    add(`<rect x="1076" y="${y + 7}" width="${[54, 62, 48][i]}" height="3" rx="1" fill="${c.screenSoft}"/>`);
  });
  text(1126, 322, "iPad", { size: 15, weight: 700, anchor: "middle" });
  text(1126, 340, "home-screen app", { size: 13, fill: c.muted, anchor: "middle" });

  // The Kindle, drawn at full size and scaled into the outline.
  add(`<g transform="translate(237.2,50.4) scale(0.68)">`);
  rect(1010, 120, 180, 240, { fill: c.device, stroke: c.deviceStroke, rx: 14 });
  rect(1022, 132, 156, 196, { fill: c.screen, stroke: c.screen, rx: 3, sw: 0 });
  path("M1032,146 H1168", { stroke: c.screenInk, sw: 0.8 });
  text(1100, 167, "Early Edition", { font: SERIF, size: 17, weight: 700, fill: c.screenInk, anchor: "middle" });
  path("M1032,175 H1168", { stroke: c.screenInk, sw: 1.6 });
  path("M1032,179 H1168", { stroke: c.screenInk, sw: 0.6 });
  for (let i = 0; i < 4; i++) {
    const y = 186 + i * 34, read = i === 0, ink = read ? c.screenSoft : c.screenInk;
    add(`<circle cx="1039" cy="${y + 15}" r="6" fill="none" stroke="${ink}" stroke-width="1.2"/>`);
    add(`<rect x="1053" y="${y + 9}" width="${[84, 72, 88, 66][i]}" height="5" rx="1" fill="${ink}"/>`);
    add(`<rect x="1053" y="${y + 19}" width="${[60, 68, 54, 62][i]}" height="3" rx="1" fill="${c.screenSoft}"/>`);
    if (read) {
      add(`<circle cx="1160" cy="${y + 15}" r="7" fill="${c.screenInk}"/>`);
      path(`M1156.5,${y + 15} L1159,${y + 17.5} L1163.5,${y + 12.5}`, { stroke: c.screen, sw: 1.5 });
    } else {
      add(`<rect x="1150" y="${y + 10}" width="19" height="10" fill="none" stroke="${c.screenInk}" stroke-width="1"/>`);
    }
    if (i < 3) path(`M1032,${y + 32} H1168`, { stroke: c.screenSoft, sw: 0.5 });
  }
  add(`</g>`);
  text(985, 322, "Kindle", { size: 15, weight: 700, anchor: "middle" });
  text(985, 340, "KOReader plugin", { size: 13, fill: c.muted, anchor: "middle" });

  // ---- Right column: the sign-in and the parent's phone ----
  path("M756,470 H794", { end: "ink" });
  path("M902,470 H1045", { end: "ink", start: "ink" });
  rect(798, 448, 104, 44, { rx: 22 });
  rect(817, 468, 13, 11, { rx: 2, fill: c.ink, sw: 0 });
  path("M819.5,468 V464 A4,4 0 0 1 827.5,464 V468", { sw: 1.6 });
  text(838, 475, "Sign-in", { size: 13.5, weight: 700 });
  text(975, 461, "HTTPS", { size: 13.5, anchor: "middle" });

  rect(1050, 425, 100, 175, { fill: c.device, stroke: c.deviceStroke, rx: 16 });
  rect(1057, 433, 86, 159, { fill: c.phoneScreen, stroke: c.phoneScreen, rx: 10, sw: 0 });
  add(`<rect x="1066" y="447" width="42" height="5" rx="1" fill="${c.phoneInk}"/>`);
  for (let i = 0; i < 7; i++) {
    const on = i !== 3;
    add(`<rect x="${1066 + i * 10}" y="462" width="7" height="7" rx="1.5" fill="${on ? c.accent : "none"}" stroke="${on ? c.accent : c.phoneSoft}" stroke-width="1"/>`);
  }
  [14, 24, 10, 0, 20, 32, 26].forEach((h, i) =>
    add(`<rect x="${1066 + i * 10}" y="${528 - h}" width="7" height="${h}" fill="${i === 6 ? c.accent : c.phoneInk}"/>`));
  path("M1066,528.5 H1134", { stroke: c.phoneSoft, sw: 1 });
  add(`<rect x="1066" y="542" width="66" height="4" rx="1" fill="${c.phoneSoft}"/>`);
  add(`<rect x="1066" y="552" width="50" height="4" rx="1" fill="${c.phoneSoft}"/>`);
  add(`<rect x="1066" y="566" width="58" height="4" rx="1" fill="${c.phoneSoft}"/>`);
  text(1100, 624, "Parent's phone", { size: 15, weight: 700, anchor: "middle" });
  text(1100, 642, "dashboard PWA", { size: 13, fill: c.muted, anchor: "middle" });

  // ---- Numbered callouts, and their key along the bottom ----
  badge(344, 153, 1);
  badge(774, 288, 2);
  badge(886, 314, 3);
  badge(806, 449, 4);

  path("M36,668 H1204", { sw: 1 });
  const key = [
    ["The paper is made at 05:30", "About six stories for each reader,", "picked, rewritten and checked by AI."],
    ["The reader fetches it", "A Kindle when it wakes, an iPad", "from its home-screen app."],
    ["Reading comes back", "What is opened and finished", "shapes tomorrow's picks."],
    ["A parent looks in", "See what was read and what the", "checker found; hide or add stories."],
  ];
  key.forEach(([title, a, b], i) => {
    const x = 36 + i * 302;
    badge(x + 12, 696, i + 1);
    text(x + 32, 701, title, { size: 14.5, weight: 700 });
    text(x + 32, 721, a, { size: 13.5, fill: c.muted });
    text(x + 32, 739, b, { size: 13.5, fill: c.muted });
  });

  const marker = (id, fill, start) =>
    `<marker id="${start ? "start" : "end"}-${id}" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="10" ` +
    `refX="${start ? 1 : 10}" refY="5" orient="auto"><path d="${start ? "M11,0 L0,5 L11,10 Z" : "M0,0 L11,5 L0,10 Z"}" fill="${fill}"/></marker>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
<title id="t">Early Edition Kids: how it fits together</title>
<desc id="d">Every morning at 05:30, the server on a home machine (Docker or Kubernetes) starts the day's run. For each reader it fetches news feeds and their photos, uses an AI model to select, rewrite for the reader's age and check about six stories, and stores them in SQLite. A Kindle (through a KOReader plugin) or an iPad (as a home-screen web app) downloads the paper from port 8080 and sends back what was read. A parent reaches the dashboard on port 8081 over HTTPS, through its built-in sign-in or the home network's own. A nightly job backs the database up to a NAS.</desc>
<defs>${marker("ink", c.ink)}${marker("ink", c.ink, true)}${marker("muted", c.muted)}<marker id="end-small" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="${c.ink}"/></marker></defs>
<rect width="${W}" height="${H}" fill="${c.bg}"/>
${out.join("\n")}
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
for (const [name, colours] of Object.entries(themes)) {
  writeFileSync(new URL(`system-${name}.svg`, OUT), draw(colours));
  console.log(`wrote docs/images/architecture/system-${name}.svg`);
}
