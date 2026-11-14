/** In-memory jobs for slow dashboard actions (adding an article runs extract, rewrite and check). */

import { randomUUID } from "node:crypto";
import type { AddWhen, Job, StoryCard } from "./types.js";

const KEEP_MS = 6 * 3600_000;
const MAX_JOBS = 200;

export class Jobs {
  private jobs = new Map<string, Job & { created: number }>();

  /** Start `work` in the background and return the pending job at once. */
  start(when: AddWhen, work: (jobId: string) => Promise<{ ok: boolean; story: StoryCard | null; reasons: string[] }>): Job {
    this.prune();
    const job: Job & { created: number } = { id: randomUUID(), status: "pending", when, story: null, reasons: [], created: Date.now() };
    this.jobs.set(job.id, job);
    const settled = work(job.id).then(
      (r) => {
        job.status = r.ok ? "done" : "failed";
        job.story = r.story;
        job.reasons = r.reasons;
      },
      (err) => {
        console.error("dashboard job failed", err);
        job.status = "failed";
        job.reasons = [`unexpected error: ${String(err)}`];
      },
    );
    this.pending.add(settled);
    void settled.finally(() => this.pending.delete(settled));
    return this.view(job);
  }

  /** Promises of running jobs (tests and shutdown can wait for them). */
  readonly pending = new Set<Promise<void>>();

  get(id: string): Job | null {
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }

  private view(job: Job & { created: number }): Job {
    return { id: job.id, status: job.status, when: job.when, story: job.story, reasons: [...job.reasons] };
  }

  private prune(): void {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, job] of this.jobs) if (job.status !== "pending" && job.created < cutoff) this.jobs.delete(id);
    while (this.jobs.size >= MAX_JOBS) {
      const oldest = [...this.jobs.entries()].find(([, j]) => j.status !== "pending");
      if (!oldest) break;
      this.jobs.delete(oldest[0]);
    }
  }
}
