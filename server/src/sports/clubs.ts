/**
 * Our own names for the clubs, and how each feed's names map onto them (docs/sports-page.md 4 and 6).
 * The two feeds spell clubs differently ("Nott'm Forest", "Nottingham Forest"), so both are matched
 * here by their normalised names. A club that isn't in the table still shows, under the provider's
 * name, cleaned.
 */

import type { Club } from "./types.js";

interface KnownClub extends Club {
  /** Other names the feeds use, besides `name` and `short`. */
  aliases: string[];
}

const club = (id: string, name: string, short: string, ...aliases: string[]): KnownClub => ({ id, name, short, aliases });

/** Every recent Premier League club and the likeliest to be promoted. */
export const KNOWN_CLUBS: KnownClub[] = [
  club("arsenal", "Arsenal", "Arsenal"),
  club("aston-villa", "Aston Villa", "Aston Villa", "Villa"),
  club("bournemouth", "Bournemouth", "Bournemouth", "AFC Bournemouth"),
  club("brentford", "Brentford", "Brentford"),
  club("brighton", "Brighton & Hove Albion", "Brighton", "Brighton and Hove Albion"),
  club("burnley", "Burnley", "Burnley"),
  club("chelsea", "Chelsea", "Chelsea"),
  club("coventry", "Coventry City", "Coventry"),
  club("crystal-palace", "Crystal Palace", "Crystal Palace", "C Palace", "Palace"),
  club("everton", "Everton", "Everton"),
  club("fulham", "Fulham", "Fulham"),
  club("hull", "Hull City", "Hull"),
  club("ipswich", "Ipswich Town", "Ipswich"),
  club("leeds", "Leeds United", "Leeds"),
  club("leicester", "Leicester City", "Leicester"),
  club("liverpool", "Liverpool", "Liverpool"),
  club("luton", "Luton Town", "Luton"),
  club("man-city", "Manchester City", "Man City"),
  club("man-utd", "Manchester United", "Man Utd", "Man United"),
  club("middlesbrough", "Middlesbrough", "Middlesbrough", "Boro"),
  club("millwall", "Millwall", "Millwall"),
  club("newcastle", "Newcastle United", "Newcastle"),
  club("norwich", "Norwich City", "Norwich"),
  club("nottm-forest", "Nottingham Forest", "Nottm Forest", "Nott'm Forest", "Forest"),
  club("portsmouth", "Portsmouth", "Portsmouth"),
  club("qpr", "Queens Park Rangers", "QPR"),
  club("sheffield-utd", "Sheffield United", "Sheffield Utd", "Sheff Utd"),
  club("sheffield-wed", "Sheffield Wednesday", "Sheffield Wed", "Sheff Wed"),
  club("southampton", "Southampton", "Southampton"),
  club("stoke", "Stoke City", "Stoke"),
  club("sunderland", "Sunderland", "Sunderland"),
  club("swansea", "Swansea City", "Swansea"),
  club("spurs", "Tottenham Hotspur", "Spurs", "Tottenham"),
  club("watford", "Watford", "Watford"),
  club("west-brom", "West Bromwich Albion", "West Brom"),
  club("west-ham", "West Ham United", "West Ham"),
  club("wolves", "Wolverhampton Wanderers", "Wolves", "Wolverhampton"),
  club("wrexham", "Wrexham", "Wrexham"),
  club("bristol-city", "Bristol City", "Bristol City"),
  club("blackburn", "Blackburn Rovers", "Blackburn"),
  club("cardiff", "Cardiff City", "Cardiff"),
  club("derby", "Derby County", "Derby"),
  club("preston", "Preston North End", "Preston"),
  club("charlton", "Charlton Athletic", "Charlton"),
  club("oxford", "Oxford United", "Oxford"),
  club("birmingham", "Birmingham City", "Birmingham"),
  club("plymouth", "Plymouth Argyle", "Plymouth"),
];

/** Lowercase letters and digits only, accents dropped, "&" as "and", without "FC" or "AFC". */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a?fc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_NAME = new Map<string, KnownClub>();
for (const c of KNOWN_CLUBS) {
  for (const n of [c.name, c.short, ...c.aliases]) BY_NAME.set(normaliseName(n), c);
}

/** Plain text: no tags or control characters, single spaces, at most `max` characters. */
export function cleanText(value: unknown, max = 40): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\p{Cc}\p{Cf}<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, max).join("").trim();
}

/** The known club any of these names belongs to, or null. */
export function knownClub(...names: (string | null | undefined)[]): Club | null {
  for (const n of names) {
    if (!n) continue;
    const c = BY_NAME.get(normaliseName(n));
    if (c) return { id: c.id, name: c.name, short: c.short };
  }
  return null;
}

/** A club the table doesn't know: the provider's names, cleaned, under an id made from them. */
export function unknownClub(name: string, short?: string | null): Club | null {
  const full = cleanText(name);
  if (!full) return null;
  const slug = normaliseName(full).replace(/ /g, "-");
  if (!slug) return null;
  return { id: `x-${slug}`, name: full, short: cleanText(short ?? "") || full };
}

/** Whether `text` (config `favourite_team`) names this club. */
export function namesClub(club: Club, text: string): boolean {
  const want = normaliseName(text);
  if (!want) return false;
  if (normaliseName(club.name) === want || normaliseName(club.short) === want) return true;
  const known = BY_NAME.get(want);
  return known !== undefined && known.id === club.id;
}
