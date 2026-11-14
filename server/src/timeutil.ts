/** Europe/London dates. "Today" always means the London date (CONTRACT.md). Dates are "YYYY-MM-DD" strings. */

export const LONDON = "Europe/London";

const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" });

export function londonDate(now: Date): string {
  return ymd.format(now);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const longParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "Saturday 14 November 2026". Accepts a YYYY-MM-DD date or an instant. */
export function longDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(`${value}T12:00:00Z`) : value;
  const parts = Object.fromEntries(longParts.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

/** Offset of London from UTC in minutes at a given instant. */
function londonOffsetMinutes(at: Date): number {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The reference time for a run: the real time for today, else 06:00 London on that date. */
export function generationNow(target: string, now: Date): Date {
  if (londonDate(now) === target) return now;
  const guess = new Date(`${target}T06:00:00Z`);
  return new Date(guess.getTime() - londonOffsetMinutes(guess) * 60000);
}

/** "13 Nov 19:30" in London time, for the dashboard. */
export function shortLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(d)
    .replace(",", "");
}
