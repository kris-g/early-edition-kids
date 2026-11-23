/**
 * The Sport page's data for the whole server (docs/sports-page.md): one state file shared by every
 * profile, fetched once a day with the morning paper, and read by each profile's routes.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { Mutex } from "../pipeline.js";
import { londonDate } from "../timeutil.js";
import { httpFetchJson, type JsonFetcher } from "./feeds.js";
import { refreshState } from "./refresh.js";
import { emptyState, type IssueSports, type SportsState, type SportsView } from "./types.js";
import { issueSports, matchLabel, sportsView } from "./view.js";

export type { JsonFetcher } from "./feeds.js";

export const sportsFile = (dataDir: string) => path.join(dataDir, "sports", "premier-league.json");

export interface RefreshOutcome {
  status: "ok" | "partial" | "failed";
  updated_at: string | null;
  errors: string[];
}

export class Sports {
  private state: SportsState;
  private readonly mutex = new Mutex();

  constructor(
    private readonly file: string,
    private readonly fetchJson: JsonFetcher = httpFetchJson,
  ) {
    this.state = Sports.load(file);
  }

  static load(file: string): SportsState {
    if (!existsSync(file)) return emptyState();
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (data?.version === 1) return { ...emptyState(), ...data };
    } catch (err) {
      console.warn(`sports: ${file} could not be read (${(err as Error).message}); starting afresh`);
    }
    return emptyState();
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.file);
  }

  /** Fetch now. One at a time; a second call waits for the first. */
  refresh(now: Date): Promise<RefreshOutcome> {
    return this.mutex.run(async () => {
      const before = this.state.fetched_at;
      this.state = await refreshState(this.state, this.fetchJson, now);
      this.save();
      const { errors, fetched_at } = this.state;
      const status = errors.length === 0 ? "ok" : fetched_at !== before ? "partial" : "failed";
      if (errors.length) console.warn(`sports: ${status}: ${errors.join("; ")}`);
      else console.log(`sports: fetched round ${this.state.latest?.number ?? "-"}`);
      return { status, updated_at: fetched_at, errors };
    });
  }

  /** The morning fetch: skipped when today's has already worked. */
  async refreshDaily(now: Date): Promise<RefreshOutcome | null> {
    const s = this.state;
    if (s.fetched_at && !s.errors.length && londonDate(new Date(s.fetched_at)) === londonDate(now)) return null;
    return this.refresh(now);
  }

  /** Start the morning fetch without waiting for it; a failure is logged, never thrown. */
  refreshInBackground(now: Date): void {
    this.refreshDaily(now).catch((err) => console.error("sports: fetch failed", err));
  }

  view(config: Config, now: Date): SportsView | null {
    return sportsView(this.state, config, now);
  }

  issueField(now: Date): IssueSports | null {
    return issueSports(this.state, now);
  }

  matchLabel(id: string): string | null {
    return matchLabel(this.state, id);
  }

  /** For the dashboard's Server page. */
  status(): { updated_at: string | null; attempted_at: string | null; error: string | null } {
    return {
      updated_at: this.state.fetched_at,
      attempted_at: this.state.attempted_at,
      error: this.state.errors.length ? this.state.errors.join("; ") : null,
    };
  }
}
