// The Sport page (docs/sports-page.md). The feeds are the real round 11 of 2026-27, recorded on
// 23 November 2026 (tests/fixtures/sports/), read as the server would on Sunday and Monday morning.

import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { Sports } from "../src/sports/index.js";
import { URLS, cleanMinute, cleanScore, lineFor, parseEspnScoreboard, parseFplFixtures, settleOwnGoals } from "../src/sports/feeds.js";
import { cleanText, knownClub, namesClub } from "../src/sports/clubs.js";
import { pickRounds, refreshState, roundsFrom } from "../src/sports/refresh.js";
import { emptyState, type SportsState } from "../src/sports/types.js";
import { STALE_AFTER_MS, sportsView } from "../src/sports/view.js";
import { ADMIN, Clock, FIXTURES, exampleConfigData, generateReq, makeApp, postEvents, tmpDir, type TestApp } from "./helpers.js";

const DIR = path.join(FIXTURES, "sports");
const SUNDAY = new Date("2026-11-22T05:30:00Z");
const MONDAY = new Date("2026-11-23T05:30:00Z");
const LIVERPOOL_MAN_UTD = "2645301";
const CHELSEA_LEEDS = "2645298";
const BRENTFORD_EVERTON = "2645297";

const FILES: Record<string, string> = {
  [URLS.fplBootstrap]: "fpl-bootstrap.json",
  [URLS.fplFixtures]: "fpl-fixtures.json",
  [URLS.espnStandings]: "espn-standings.json",
  [URLS.espnScoreboard("20261121")]: "espn-scoreboard-20261121.json",
  [URLS.espnScoreboard("20261122")]: "espn-scoreboard-20261122.json",
  [URLS.espnScoreboard("20261123")]: "espn-scoreboard-20261123.json",
  [URLS.espnSummary("401878755")]: "espn-summary-401878755.json",
  [URLS.espnSummary("401879236")]: "espn-summary-401879236.json",
};

const read = (file: string) => JSON.parse(readFileSync(path.join(DIR, file), "utf8"));

/** Serves the recorded feeds; anything else (the other eight match summaries) is a 404. */
function feeds(calls: string[] = [], tweak: (url: string, data: any) => any = (_u, d) => d) {
  return async (url: string) => {
    calls.push(url);
    const file = FILES[url];
    if (!file) throw new Error(`HTTP 404 for ${url}`);
    return tweak(url, read(file));
  };
}

const failing = async (url: string): Promise<unknown> => {
  throw new Error(`HTTP 503 for ${url}`);
};

const sportsConfig = (extra: Record<string, unknown> = {}) => parseConfig({ ...exampleConfigData(), sports: { enabled: true }, ...extra });

const match = (s: SportsState, id: string) => [...(s.latest?.matches ?? []), ...(s.next?.matches ?? [])].find((m) => m.id === id)!;

describe("the feeds", () => {
  it("names clubs our way whichever feed spells them", () => {
    expect(knownClub("Nott'm Forest")?.id).toBe("nottm-forest");
    expect(knownClub("Nottingham Forest")?.short).toBe("Nottm Forest");
    expect(knownClub("C Palace")?.short).toBe("Crystal Palace");
    expect(knownClub("AFC Bournemouth")?.id).toBe("bournemouth");
    expect(knownClub("Brighton & Hove Albion")?.short).toBe("Brighton");
    expect(knownClub("Tottenham Hotspur")?.short).toBe("Spurs");
    expect(knownClub("Atlantis Rovers")).toBeNull();
    expect(namesClub(knownClub("Liverpool")!, "liverpool fc")).toBe(true);
    expect(namesClub(knownClub("Manchester United")!, "Man United")).toBe(true);
    expect(namesClub(knownClub("Manchester City")!, "Manchester United")).toBe(false);
  });

  it("keeps names plain and short, and believes only real minutes and scores", () => {
    expect(cleanText("<b>Szo</b>boszlai\u0007")).toBe("Szo boszlai");
    expect(cleanText("x".repeat(60))).toHaveLength(40);
    expect(cleanMinute("90'+4'")).toBe("90'+4'");
    expect(cleanMinute("67'")).toBe("67'");
    expect(cleanMinute("HT")).toBeNull();
    expect(cleanScore("4", 0)).toEqual({ home: 4, away: 0 });
    expect(cleanScore(99, 0)).toBeNull();
    expect(cleanScore(-1, 0)).toBeNull();
    expect(cleanScore("2.5", 0)).toBeNull();
  });

  it("sorts ESPN's positions into lines", () => {
    expect(["G", "CD-L", "RB", "LB", "CD", "LWB", "DM", "CM-R", "AM-L", "LM", "F", "CF-R", "RW"].map(lineFor)).toEqual([
      "goalkeeper", "defenders", "defenders", "defenders", "defenders", "defenders",
      "midfielders", "midfielders", "midfielders", "midfielders", "forwards", "forwards", "forwards",
    ]);
  });

  it("knows who on the injury list played, by surname", async () => {
    const { inSquad } = await import("../src/sports/feeds.js");
    const squad = ["Bradley Barcola", "Alexander Isak", "Virgil van Dijk", "Víctor Muñoz"];
    expect(inSquad("Isak", squad)).toBe(true);
    expect(inSquad("van Dijk", squad)).toBe(true);
    expect(inSquad("Munoz", squad)).toBe(true);
    expect(inSquad("Bradley", squad)).toBe(false);
  });

  it("moves own goals across when that is what makes them add up", () => {
    const og = { side: "away" as const, player: "McNeil", minute: "85'", kind: "own_goal" as const };
    const home = { side: "home" as const, player: "Awoniyi", minute: "5'", kind: "goal" as const };
    expect(settleOwnGoals([home, og], { home: 2, away: 0 }).map((g) => g.side)).toEqual(["home", "home"]);
    expect(settleOwnGoals([home, og], { home: 1, away: 1 }).map((g) => g.side)).toEqual(["home", "away"]);
  });

  it("reads a day's scores, with goals by surname", () => {
    const sat = parseEspnScoreboard(read("espn-scoreboard-20261121.json"));
    expect(sat).toHaveLength(7);
    const chelsea = sat.find((m) => m.home === "chelsea")!;
    expect(chelsea).toMatchObject({ away: "leeds", state: "finished", score: { home: 1, away: 4 } });
    expect(chelsea.goals.map((g) => `${g.side} ${g.player} ${g.minute} ${g.kind}`)).toEqual([
      "home Emegha 25' goal",
      "away Okafor 28' goal",
      "away Calvert-Lewin 53' penalty",
      "away Okafor 58' goal",
      "away Aaronson 90'+1' goal",
    ]);
    const coventry = sat.find((m) => m.home === "coventry")!;
    expect(coventry.goals.filter((g) => g.side === "home")).toHaveLength(3);
    expect(coventry.goals.find((g) => g.kind === "own_goal")?.side).toBe("home");
  });

  it("shows a match with an unbelievable score as not played", () => {
    const data = read("espn-scoreboard-20261121.json");
    data.events[0].competitions[0].competitors[0].score = "99";
    expect(parseEspnScoreboard(data)[0]).toMatchObject({ state: "other", score: null, goals: [] });
  });

  it("picks the latest round and the next", () => {
    const fixtures = parseFplFixtures(read("fpl-fixtures.json"), new Map(read("fpl-bootstrap.json").teams.map((t: any) => [t.id, knownClub(t.name)!])));
    const rounds = roundsFrom(fixtures);
    const at = (iso: string) => {
      const p = pickRounds(rounds, new Date(iso));
      return [p.latest?.number ?? null, p.next?.number ?? null];
    };
    expect(at("2026-11-23T05:30:00Z")).toEqual([11, 12]); // Monday: the weekend's round
    expect(at("2026-11-26T12:00:00Z")).toEqual([11, 12]); // Thursday: still the weekend's
    expect(at("2026-11-27T21:00:00Z")).toEqual([12, 13]); // after Friday night's kick-off
    expect(at("2026-06-01T12:00:00Z")).toEqual([null, 1]); // before the season
    expect(at("2027-06-30T12:00:00Z")).toEqual([38, null]); // after it
  });
});

describe("the daily fetch", () => {
  it("reads Monday morning's page: the weekend's results, Monday night's kick-off, the table and the next round", async () => {
    const calls: string[] = [];
    const s = await refreshState(emptyState(), feeds(calls), MONDAY);
    expect(s.fetched_at).toBe(MONDAY.toISOString());
    expect(s.latest?.number).toBe(11);
    expect(s.latest?.matches).toHaveLength(10);
    expect(s.latest?.matches.filter((m) => m.state === "finished")).toHaveLength(9);
    expect(match(s, BRENTFORD_EVERTON)).toMatchObject({ state: "scheduled", score: null, home: "brentford", away: "everton" });
    expect(match(s, LIVERPOOL_MAN_UTD)).toMatchObject({ state: "finished", score: { home: 4, away: 0 }, espn_id: "401878755" });
    expect(s.next?.number).toBe(12);
    expect(s.next?.matches).toHaveLength(10);
    expect(s.next?.matches.every((m) => m.state === "scheduled" && m.score === null)).toBe(true);
    expect(s.table?.rows).toHaveLength(20);
    expect(s.table?.rows[3]).toEqual({ position: 4, team: "liverpool", played: 11, won: 6, drawn: 3, lost: 2, goal_difference: 8, points: 21 });
    expect(s.table?.lines).toEqual([{ after: 4, label: "Champions League" }, { after: 17, label: "Relegation" }]);
    expect(s.table?.final).toBe(false);
    expect(s.clubs).toHaveLength(20);
    // Only the days played so far, one at a time; Monday's scoreboard isn't asked for yet.
    expect(calls.filter((u) => u.includes("scoreboard"))).toEqual([URLS.espnScoreboard("20261121"), URLS.espnScoreboard("20261122")]);
    // Two summaries are recorded; the other seven played matches can't be fetched and are named.
    expect(Object.keys(s.details).sort()).toEqual([CHELSEA_LEEDS, LIVERPOOL_MAN_UTD].sort());
    expect(s.errors).toHaveLength(7);
    expect(s.errors.every((e) => e.startsWith("match "))).toBe(true);
  });

  it("reads a match: goals, cards, substitutions and line-ups", async () => {
    const s = await refreshState(emptyState(), feeds(), MONDAY);
    const d = s.details[LIVERPOOL_MAN_UTD];
    expect(d.goals.map((g) => `${g.side} ${g.player} ${g.minute} ${g.kind}`)).toEqual([
      "home Dominik Szoboszlai 10' goal",
      "home Florian Wirtz 13' goal",
      "home Rio Ngumoha 66' goal",
      "home Víctor Muñoz 82' goal",
    ]);
    expect(d.cards).toEqual([
      { side: "away", player: "Leny Yoro", minute: "8'", card: "red" },
      { side: "home", player: "Bradley Barcola", minute: "62'", card: "yellow" },
    ]);
    expect(d.penalties).toEqual([]);
    expect(d.subs).toHaveLength(10);
    expect(d.subs[0]).toEqual({ side: "away", minute: "22'", on: "Harry Maguire", off: "Bryan Mbeumo", injury: false });
    const home = d.lineups.home;
    expect(home.starting.map((g) => [g.line, g.players.length])).toEqual([["goalkeeper", 1], ["defenders", 4], ["midfielders", 5], ["forwards", 1]]);
    expect(home.starting[0].players[0]).toEqual({ name: "Alisson Becker", number: "1", on: null, off: null });
    expect(home.starting[1].players.find((p) => p.name === "Ronald Araujo")?.off).toBe("85'");
    expect(home.bench).toHaveLength(9);
    expect(home.bench.find((p) => p.name === "Víctor Muñoz")).toEqual({ name: "Víctor Muñoz", number: "23", on: "72'", off: null });

    const leeds = s.details[CHELSEA_LEEDS];
    expect(leeds.goals.find((g) => g.kind === "penalty")).toEqual({ side: "away", player: "Dominic Calvert-Lewin", minute: "53'", kind: "penalty" });
    expect(leeds.subs.filter((x) => x.injury)).toEqual([{ side: "home", minute: "22'", on: "Jordan Henderson", off: "Moisés Caicedo", injury: true }]);
  });

  it("takes each morning's injury list for matches to come, and keeps it once they have kicked off", async () => {
    // The recorded list, with Isak added: he played, so he must not be shown as out.
    const tweak = (url: string, data: any) => {
      if (url === URLS.fplBootstrap) data.elements.push({ web_name: "Isak", team: 14, status: "i", news: "" });
      return data;
    };
    const sunday = await refreshState(emptyState(), feeds([], tweak), SUNDAY);
    expect(sunday.latest?.number).toBe(11);
    expect(match(sunday, LIVERPOOL_MAN_UTD).state).toBe("scheduled"); // not until 16:30
    expect(sunday.injuries[LIVERPOOL_MAN_UTD].home).toEqual(expect.arrayContaining(["Bradley", "Ekitiké", "Isak"]));
    expect(sunday.injuries[CHELSEA_LEEDS]).toBeUndefined(); // played on Saturday, before any list was taken

    const monday = await refreshState(sunday, feeds(), MONDAY);
    expect(monday.injuries[LIVERPOOL_MAN_UTD]).toEqual(sunday.injuries[LIVERPOOL_MAN_UTD]);
    const view = sportsView(monday, sportsConfig(), MONDAY)!;
    const liv = view.matchday!.days.flatMap((d) => d.matches).find((m) => m.id === LIVERPOOL_MAN_UTD)!;
    expect(liv.detail?.out_injured.home).toEqual(["Jaros", "Bradley", "Leoni", "Ekitiké"]);
    expect(liv.detail?.out_injured.away).toEqual(["Baleba", "Shaw", "Rashford", "Ugarte", "Šeško"]);
  });

  it("keeps details already fetched instead of asking again", async () => {
    const first = await refreshState(emptyState(), feeds(), MONDAY);
    const calls: string[] = [];
    await refreshState(first, feeds(calls), MONDAY);
    expect(calls.filter((u) => u.includes("summary?event=401878755"))).toEqual([]);
  });

  it("keeps the last good state when the feeds fail, and names what failed", async () => {
    const good = await refreshState(emptyState(), feeds(), MONDAY);
    const later = new Date(MONDAY.getTime() + 24 * 3600 * 1000);
    const bad = await refreshState(good, failing, later);
    expect(bad.fetched_at).toBe(good.fetched_at);
    expect(bad.attempted_at).toBe(later.toISOString());
    expect(bad.latest).toEqual(good.latest);
    expect(bad.table?.rows).toEqual(good.table?.rows);
    expect(bad.details).toEqual(good.details);
    expect(bad.errors.slice(0, 2).map((e) => e.split(":")[0])).toEqual(["table", "clubs and injuries"]);
    // The seven summaries it never got are tried again, and fail again.
    expect(bad.errors.slice(2)).toHaveLength(7);
    expect(bad.errors.slice(2).every((e) => e.startsWith("match "))).toBe(true);
  });

  it("keeps the rest when one part fails", async () => {
    const s = await refreshState(emptyState(), feeds([], (url, data) => (url === URLS.espnStandings ? { nothing: true } : data)), MONDAY);
    expect(s.table).toBeNull();
    expect(s.latest?.matches.filter((m) => m.state === "finished")).toHaveLength(9);
    expect(s.errors[0]).toMatch(/^table: ESPN's table did not look as expected/);
  });

  it("falls back to the Fantasy feed's scores when ESPN has no day", async () => {
    const s = await refreshState(emptyState(), feeds([], (url, data) => {
      if (url.includes("scoreboard")) throw new Error("HTTP 500");
      return data;
    }), MONDAY);
    expect(match(s, LIVERPOOL_MAN_UTD)).toMatchObject({ state: "finished", score: { home: 4, away: 0 }, goals: [], espn_id: null });
    expect(s.details).toEqual({});
  });
});

describe("the page", () => {
  it("groups the round by London day and marks his club", async () => {
    const s = await refreshState(emptyState(), feeds(), MONDAY);
    const v = sportsView(s, sportsConfig(), MONDAY)!;
    expect(v.competition).toBe("Premier League");
    expect(v.updated_at).toBe(MONDAY.toISOString());
    expect(v.results_to).toBe("2026-11-22");
    expect(v.favourite_team).toBe("liverpool");
    expect(v.teams.find((c) => c.id === "man-utd")).toEqual({ id: "man-utd", name: "Manchester United", short: "Man Utd" });
    expect(v.matchday!.number).toBe(11);
    expect(v.matchday!.days.map((d) => [d.date, d.matches.length])).toEqual([["2026-11-21", 7], ["2026-11-22", 2], ["2026-11-23", 1]]);
    expect(v.next!.days.map((d) => [d.date, d.matches.length])).toEqual([["2026-11-27", 1], ["2026-11-28", 3], ["2026-11-29", 6]]);
    expect(v.next!.days.flatMap((d) => d.matches).every((m) => m.detail === null && m.score === null)).toBe(true);
    const monday = v.matchday!.days[2].matches[0];
    expect(monday).toMatchObject({ home: "brentford", away: "everton", state: "scheduled", score: null, goals: [], detail: null });
    const city = v.matchday!.days[0].matches[0];
    expect(city).toMatchObject({ home: "man-city", away: "fulham", score: { home: 1, away: 1 }, detail: null }); // no summary recorded
    expect(city.goals.map((g) => g.player)).toEqual(["Muniz", "Anderson"]);
    expect(v.table!.rows[0].team).toBe("arsenal");
  });

  it("says nothing in the feeds' own words", async () => {
    const s = await refreshState(emptyState(), feeds(), MONDAY);
    const json = JSON.stringify(sportsView(s, sportsConfig(), MONDAY));
    const bootstrap = read("fpl-bootstrap.json");
    const news = bootstrap.elements.map((e: any) => e.news).filter((n: string) => n && n.length > 12);
    const commentary = ["espn-summary-401878755.json", "espn-summary-401879236.json"].flatMap((f) => read(f).commentary.map((c: any) => c.text));
    expect(news.length).toBeGreaterThan(20);
    for (const text of [...news, ...commentary.filter((t: string) => t.length > 12)]) expect(json).not.toContain(text);
    for (const word of ["DraftKings", "because of an injury", "right footed", "Goal!", "espncdn", "Expected back", "chance of playing", "http"]) {
      expect(json).not.toContain(word);
    }
  });

  it("leaves out a name the blocklist catches", async () => {
    const s = await refreshState(emptyState(), feeds(), MONDAY);
    const v = sportsView(s, sportsConfig({ blocklist: ["Yoro"] }), MONDAY)!;
    const liv = v.matchday!.days[1].matches.find((m) => m.id === LIVERPOOL_MAN_UTD)!;
    expect(JSON.stringify(liv)).not.toContain("Yoro");
    expect(liv.detail!.cards).toHaveLength(1);
  });

  it("is taken down when it is three days old", async () => {
    const s = await refreshState(emptyState(), feeds(), MONDAY);
    expect(sportsView(s, sportsConfig(), new Date(MONDAY.getTime() + STALE_AFTER_MS))).not.toBeNull();
    expect(sportsView(s, sportsConfig(), new Date(MONDAY.getTime() + STALE_AFTER_MS + 1000))).toBeNull();
    expect(sportsView(emptyState(), sportsConfig(), MONDAY)).toBeNull();
  });

  it("is kept in a file across restarts", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "sports", "premier-league.json");
    const a = new Sports(file, feeds());
    expect((await a.refresh(MONDAY)).status).toBe("partial");
    const b = new Sports(file, failing);
    expect(b.view(sportsConfig(), MONDAY)?.matchday?.number).toBe(11);
    expect(b.matchLabel(LIVERPOOL_MAN_UTD)).toBe("Liverpool 4–0 Man Utd");
    expect(b.matchLabel(BRENTFORD_EVERTON)).toBe("Brentford v Everton");
    expect(b.matchLabel("nope")).toBeNull();
    // The morning fetch runs again after a partial one, and reports a failure without losing anything.
    expect((await b.refreshDaily(MONDAY))?.status).toBe("failed");
    expect(b.view(sportsConfig(), MONDAY)?.matchday?.number).toBe(11);
  });
});

describe("the server", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  const sportApp = () => makeApp({ config: sportsConfig(), sportsFetcher: feeds(), clock: new Clock(MONDAY) });
  const viewed = (ceid: string, payload: Record<string, unknown>, ts = Math.floor(MONDAY.getTime() / 1000) + 600) => ({
    client_event_id: ceid,
    story_id: null,
    type: "sport_viewed",
    ts,
    payload,
  });

  it("has no Sport page unless the config turns it on", async () => {
    t = makeApp();
    expect((await request(t.app).get("/api/sports")).status).toBe(404);
    await generateReq(t);
    expect((await request(t.app).get("/api/issue/today")).body.sports).toBeNull();
    expect((await t.agent.get("/api/dashboard/about")).body.sport).toBeNull();
  });

  it("fetches on /admin/sports and serves the page", async () => {
    t = sportApp();
    expect((await request(t.app).get("/api/sports")).status).toBe(404); // nothing fetched yet
    expect((await request(t.app).post("/admin/sports")).status).toBe(403);
    const r = await request(t.app).post("/admin/sports").set(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "partial", updated_at: MONDAY.toISOString() });
    expect(r.body.errors).toHaveLength(7);
    const page = await request(t.app).get("/api/sports");
    expect(page.status).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.body.matchday.number).toBe(11);
    expect(page.body.favourite_team).toBe("liverpool");
    const about = (await t.agent.get("/api/dashboard/about")).body.sport;
    expect(about).toMatchObject({ updated_at: MONDAY.toISOString(), attempted_at: MONDAY.toISOString() });
    expect(about.error).toContain("match ");
  });

  it("answers 503 when nothing could be fetched", async () => {
    t = makeApp({ config: sportsConfig(), sportsFetcher: failing, clock: new Clock(MONDAY) });
    const r = await request(t.app).post("/admin/sports").set(ADMIN);
    expect(r.status).toBe(503);
    expect(r.body.status).toBe("failed");
  });

  it("fetches with the morning paper and tells the readers in the issue", async () => {
    // Generated on the fixture feeds' own morning, when the latest round was round 10: ESPN has
    // nothing recorded for it, so the results come from the Fantasy feed alone.
    t = makeApp({ config: sportsConfig(), sportsFetcher: feeds() });
    expect((await generateReq(t)).status).toBe(200);
    await request(t.app).post("/admin/sports").set(ADMIN); // waits for the background fetch
    const issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.sports).toEqual({ path: "/api/sports", label: "Premier League", matchday: 10, unlock: { needed: 3, min_seconds: expect.any(Object) } });
    const page = (await request(t.app).get("/api/sports")).body;
    expect(page.matchday.days.flatMap((d: any) => d.matches).every((m: any) => m.state === "finished" && m.detail === null)).toBe(true);
    expect(page.next.number).toBe(11);
  });

  it("is under every profile that turns it on, and only those", async () => {
    const data = { ...exampleConfigData(), profiles: [{ id: "older", sports: { enabled: true } }, { id: "younger" }] };
    const { parseProfiles } = await import("../src/config.js");
    t = makeApp({ profiles: parseProfiles(data), sportsFetcher: feeds(), clock: new Clock(MONDAY) });
    await request(t.app).post("/admin/sports").set(ADMIN);
    expect((await request(t.app).get("/p/older/api/sports")).status).toBe(200);
    expect((await request(t.app).get("/api/sports")).status).toBe(200); // older owns the root
    expect((await request(t.app).get("/p/younger/api/sports")).status).toBe(404);
  });

  it("records Sport views apart from reading, with each match's name", async () => {
    t = sportApp();
    await request(t.app).post("/admin/sports").set(ADMIN);
    const r = await postEvents(t, [
      viewed("a", { page: "matches", match_id: null, matchday: 11, active_seconds: 40 }),
      viewed("b", { page: "match", match_id: LIVERPOOL_MAN_UTD, matchday: 11, active_seconds: 95 }),
      viewed("c", { page: "table", match_id: null, matchday: 11, active_seconds: 70 }),
      viewed("d", { page: "match", match_id: LIVERPOOL_MAN_UTD, matchday: 11, active_seconds: 25 }),
      viewed("e", { page: "table", matchday: 11, active_seconds: 10 }, Math.floor(MONDAY.getTime() / 1000) - 86400), // Sunday
      // Not Sport views: an unknown page, a match with no id, a story id, absurd seconds.
      viewed("x1", { page: "news", active_seconds: 5 }),
      viewed("x2", { page: "match", active_seconds: 5 }),
      { ...viewed("x3", { page: "table", active_seconds: 5 }), story_id: 1 },
      viewed("x4", { page: "table", active_seconds: -3 }),
    ]);
    expect(r.status).toBe(200);
    expect(r.body.accepted.sort()).toEqual(["a", "b", "c", "d", "e"]);
    const stored = t.ctx.db.queryOne("SELECT payload_json FROM events WHERE client_event_id = 'b'")!;
    expect(JSON.parse(stored.payload_json)).toEqual({
      page: "match", match_id: LIVERPOOL_MAN_UTD, matchday: 11, active_seconds: 95, match: "Liverpool 4–0 Man Utd",
    });

    const day = (await t.agent.get("/api/dashboard/day/2026-11-23")).body;
    expect(day.sport).toEqual({
      date: "2026-11-23",
      views: 4,
      seconds: 230,
      pages: [
        { page: "match", match_id: LIVERPOOL_MAN_UTD, match: "Liverpool 4–0 Man Utd", views: 2, seconds: 120 },
        { page: "table", match_id: null, match: null, views: 1, seconds: 70 },
        { page: "matches", match_id: null, match: null, views: 1, seconds: 40 },
      ],
    });
    expect(day.read).toBe(0);
    expect(day.minutes).toBe(0);
    expect(day.reads).toEqual([]);
    expect((await t.agent.get("/api/dashboard/day/2026-11-21")).body.sport).toBeNull();

    const usage = (await t.agent.get("/api/dashboard/sport?days=7")).body;
    expect(usage.from).toBe("2026-11-17");
    expect(usage.to).toBe("2026-11-23");
    expect(usage.days).toHaveLength(7);
    expect(usage.days.map((d: any) => d.seconds)).toEqual([0, 0, 0, 0, 0, 10, 230]);
    expect(usage).toMatchObject({ views: 5, seconds: 240 });
    expect(usage.pages.map((p: any) => [p.page, p.views, p.seconds])).toEqual([["match", 2, 120], ["table", 2, 80], ["matches", 1, 40]]);

    // Reading is untouched.
    const summary = (await t.agent.get("/api/dashboard/summary")).body;
    expect(summary).toMatchObject({ streak: 0, week_read: 0, catch_up_today: 0 });
    const reading = (await t.agent.get("/api/dashboard/reading?days=7")).body;
    expect(reading.total_read).toBe(0);
    expect(reading.reading_days).toBe(0);
    expect(reading.days.every((d: any) => d.minutes === 0)).toBe(true);
  });
});

describe("Sport opens after reading", () => {
  let t: TestApp;
  afterEach(() => t?.cleanup());

  const DASH = { "X-Early-Edition": "1" };
  /** A paper on the fixture feeds' own morning, with the Sport data fetched for it. */
  async function paperWithSport(config = sportsConfig()) {
    t = makeApp({ config, sportsFetcher: feeds() });
    await generateReq(t);
    await request(t.app).post("/admin/sports").set(ADMIN); // waits for the morning's background fetch
    return (await request(t.app).get("/api/issue/today")).body;
  }
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const closed = (id: number, ceid: string, seconds: number, finished: boolean, ts: number) => ({
    client_event_id: ceid,
    story_id: id,
    type: "story_closed",
    ts,
    payload: { active_seconds: seconds, pages_total: 2, max_page: finished ? 2 : 1, finished },
  });

  it("puts the rule in the issue: half the stories, each read for at least half its time", async () => {
    const issue = await paperWithSport();
    expect(issue.stories).toHaveLength(6);
    expect(issue.sports.unlock.needed).toBe(3);
    const words = new Map(t.ctx.db.query("SELECT id, word_count FROM stories").map((r) => [Number(r.id), Number(r.word_count)]));
    for (const s of issue.stories) {
      expect(issue.sports.unlock.min_seconds[String(s.id)]).toBe(Math.ceil(((words.get(s.id)! / 90) * 60) / 2));
    }
  });

  it("counts stories read properly, not ones read too fast, and adds up several sittings", async () => {
    const issue = await paperWithSport();
    const [a, b, c, d] = issue.stories.map((s: any) => s.id);
    const min = (id: number) => issue.sports.unlock.min_seconds[String(id)] as number;
    await postEvents(t, [
      closed(a, "a", min(a) + 5, true, at("2026-11-14T07:00:00Z")), // counts
      closed(b, "b", 4, true, at("2026-11-14T07:01:00Z")), // paged through: too fast
      closed(c, "c1", min(c) - 10, false, at("2026-11-14T07:05:00Z")), // stopped part way
      closed(d, "d", min(d), true, at("2026-11-14T07:08:00Z")), // just enough: counts
    ]);
    let sport = (await request(t.app).get("/api/sports")).body;
    expect(sport.unlock).toEqual({ needed: 3, counted: 2, unlocked: false });

    await postEvents(t, [closed(c, "c2", 10, true, at("2026-11-14T07:20:00Z"))]); // came back and finished
    sport = (await request(t.app).get("/api/sports")).body;
    expect(sport.unlock).toEqual({ needed: 3, counted: 3, unlocked: true });

    const day = (await t.agent.get("/api/dashboard/day/2026-11-14")).body;
    expect(day.sport_unlock).toMatchObject({ needed: 3, total: 6, counted: 3, unlocked: true, unlocked_at: "2026-11-14T07:20:00.000Z" });
    const byId = new Map(day.sport_unlock.stories.map((s: any) => [s.id, s]));
    expect(byId.get(b)).toMatchObject({ finished: true, active_seconds: 4, counts: false, rushed: true });
    expect(byId.get(c)).toMatchObject({ finished: true, active_seconds: min(c), counts: true, rushed: false });
    expect(day.sport_unlock.stories.filter((s: any) => s.rushed)).toHaveLength(1);
    // Reading figures are as they always were: the rushed story was still read to the end.
    expect(day.read).toBe(4);
  });

  it("leaves hidden stories out of the count", async () => {
    const issue = await paperWithSport();
    await t.agent.post(`/api/dashboard/stories/${issue.stories[0].id}/hide`).set(DASH);
    const again = (await request(t.app).get("/api/issue/today")).body;
    expect(again.sports.unlock.needed).toBe(3); // half of five, rounded up
    expect(Object.keys(again.sports.unlock.min_seconds)).toHaveLength(5);
  });

  it("is set per child on the dashboard, over the config", async () => {
    await paperWithSport();
    let r = await t.agent.get("/api/dashboard/sport/settings");
    expect(r.body.settings).toEqual({ enabled: true, read_first: 0.5, min_reading: 0.5 });
    expect(r.body.today).toMatchObject({ needed: 3, total: 6, counted: 0, unlocked: false, unlocked_at: null });

    expect((await t.agent.put("/api/dashboard/sport/settings").send({ read_first: 1 })).status).toBe(403); // no X-Early-Edition
    for (const bad of [{ read_first: 2 }, { min_reading: -0.1 }, { enabled: "yes" }, [1]]) {
      const res = await t.agent.put("/api/dashboard/sport/settings").set(DASH).send(bad);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeTruthy();
    }

    r = await t.agent.put("/api/dashboard/sport/settings").set(DASH).send({ read_first: 1, min_reading: 0 });
    expect(r.status).toBe(200);
    expect(r.body.settings).toEqual({ enabled: true, read_first: 1, min_reading: 0 });
    let issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.sports.unlock.needed).toBe(6);
    expect(Object.values(issue.sports.unlock.min_seconds).every((s) => s === 0)).toBe(true);

    // No lock: Sport is open from the start.
    await t.agent.put("/api/dashboard/sport/settings").set(DASH).send({ read_first: 0 });
    issue = (await request(t.app).get("/api/issue/today")).body;
    expect(issue.sports.unlock).toBeNull();
    expect((await request(t.app).get("/api/sports")).body.unlock).toBeNull();
    expect((await t.agent.get("/api/dashboard/sport/settings")).body.today).toBeNull();

    // Off: no Sport page at all.
    await t.agent.put("/api/dashboard/sport/settings").set(DASH).send({ enabled: false });
    expect((await request(t.app).get("/api/sports")).status).toBe(404);
    expect((await request(t.app).get("/api/issue/today")).body.sports).toBeNull();
    expect((await t.agent.get("/api/dashboard/about")).body.sport).toBeNull();
  });

  it("can be turned on from the dashboard when the config leaves it off", async () => {
    t = makeApp({ sportsFetcher: feeds(), clock: new Clock(MONDAY) });
    expect((await t.agent.get("/api/dashboard/sport/settings")).body.settings.enabled).toBe(false);
    await t.agent.put("/api/dashboard/sport/settings").set({ "X-Early-Edition": "1" }).send({ enabled: true });
    await request(t.app).post("/admin/sports").set(ADMIN);
    expect((await request(t.app).get("/api/sports")).status).toBe(200);
    expect((await t.agent.get("/api/dashboard/about")).body.sport).not.toBeNull();
  });

  it("takes its starting values from the config", () => {
    expect(sportsConfig().sports).toEqual({ enabled: true, readFirst: 0.5, minReading: 0.5 });
    const c = parseConfig({ ...exampleConfigData(), sports: { enabled: true, read_first: 0.75, min_reading: 0.25 } });
    expect(c.sports).toEqual({ enabled: true, readFirst: 0.75, minReading: 0.25 });
    expect(() => parseConfig({ ...exampleConfigData(), sports: { read_first: 3 } })).toThrow(/sports\.read_first/);
  });
});
