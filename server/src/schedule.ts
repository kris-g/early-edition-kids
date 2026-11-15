/**
 * Optional built-in daily run, for setups with no Kubernetes CronJob (a plain `docker run`).
 * GENERATE_AT=HH:MM (Europe/London) makes the server build today's issue itself once that time
 * has passed, checking every minute and once at start, so a server started late still makes
 * the day's paper. generate() is serialised and returns "exists" for a date already built, so
 * this is safe alongside the CronJob or the dashboard's "Make it again".
 */

import { LONDON, londonDate } from "./timeutil.js";

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Minutes after London midnight for "HH:MM", or null when unset. Throws on a malformed value. */
export function parseGenerateAt(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`GENERATE_AT must be a 24-hour London time such as 05:30, not ${JSON.stringify(value)}`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes after midnight, London time. */
export function londonMinutes(now: Date): number {
  const [h, m] = clock.format(now).split(":").map(Number);
  return h * 60 + m;
}

export interface ScheduleDeps {
  /** Minutes after London midnight to run at. */
  at: number;
  /** Builds the issue for a date; resolves with its status ("created", "exists", "failed", ...). */
  run: (date: string, now: Date) => Promise<{ status: string }>;
  now?: () => Date;
  log?: (msg: string) => void;
  /** How long to wait before trying again after a failed run. */
  retryMs?: number;
}

/** One check: runs today's generation when it is due. Exposed for tests; start() calls it every minute. */
export function makeScheduler(deps: ScheduleDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string) => console.log(m));
  const retryMs = deps.retryMs ?? 30 * 60_000;
  let doneDate: string | null = null;
  let retryAfter = 0;
  let running = false;

  async function tick(): Promise<void> {
    const t = now();
    const date = londonDate(t);
    if (running || doneDate === date || londonMinutes(t) < deps.at || t.getTime() < retryAfter) return;
    running = true;
    try {
      const result = await deps.run(date, t);
      if (result.status === "failed") {
        retryAfter = t.getTime() + retryMs;
        log(`schedule: generation for ${date} failed; trying again in ${Math.round(retryMs / 60_000)} minutes`);
      } else {
        doneDate = date;
        log(`schedule: issue for ${date}: ${result.status}`);
      }
    } catch (err) {
      retryAfter = t.getTime() + retryMs;
      log(`schedule: generation for ${date} threw: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  }

  /** Checks now and then every minute. Returns a function that stops it. */
  function start(): () => void {
    void tick();
    const timer = setInterval(() => void tick(), 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { tick, start };
}
