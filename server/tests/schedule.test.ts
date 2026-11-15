import { describe, expect, it } from "vitest";
import { settingsFromEnv } from "../src/config.js";
import { londonMinutes, makeScheduler, parseGenerateAt } from "../src/schedule.js";

describe("GENERATE_AT", () => {
  it("parses a 24-hour time and treats empty as off", () => {
    expect(parseGenerateAt("05:30")).toBe(330);
    expect(parseGenerateAt("5:30")).toBe(330);
    expect(parseGenerateAt(" 23:59 ")).toBe(1439);
    expect(parseGenerateAt("")).toBeNull();
    expect(settingsFromEnv({ GENERATE_AT: " 06:00 " }).generateAt).toBe("06:00");
    expect(settingsFromEnv({}).generateAt).toBe("");
  });

  it("rejects a malformed time", () => {
    for (const bad of ["24:00", "5", "05:60", "5.30am", "noon"]) expect(() => parseGenerateAt(bad)).toThrow(/GENERATE_AT/);
  });

  it("reads the clock in London time, summer and winter", () => {
    expect(londonMinutes(new Date("2026-01-15T05:30:00Z"))).toBe(330); // GMT
    expect(londonMinutes(new Date("2026-07-15T04:30:00Z"))).toBe(330); // BST
  });
});

describe("the daily schedule", () => {
  const setup = (results: Array<{ status: string } | Error>) => {
    let t = new Date("2026-11-16T05:00:00Z");
    const calls: string[] = [];
    const logs: string[] = [];
    const s = makeScheduler({
      at: 330,
      now: () => t,
      log: (m) => logs.push(m),
      retryMs: 30 * 60_000,
      run: async (date) => {
        calls.push(date);
        const r = results.shift() ?? { status: "exists" };
        if (r instanceof Error) throw r;
        return r;
      },
    });
    return { s, calls, logs, set: (iso: string) => (t = new Date(iso)) };
  };

  it("waits for the time, runs once a day, then runs again the next day", async () => {
    const { s, calls, set } = setup([{ status: "created" }, { status: "created" }]);
    await s.tick();
    expect(calls).toEqual([]);
    set("2026-11-16T05:30:00Z");
    await s.tick();
    set("2026-11-16T09:00:00Z");
    await s.tick();
    expect(calls).toEqual(["2026-11-16"]);
    set("2026-11-17T05:31:00Z");
    await s.tick();
    expect(calls).toEqual(["2026-11-16", "2026-11-17"]);
  });

  it("makes today's paper when started after the time", async () => {
    const { s, calls, set } = setup([{ status: "created" }]);
    set("2026-11-16T14:00:00Z");
    await s.tick();
    expect(calls).toEqual(["2026-11-16"]);
  });

  it("counts an issue that already exists as done", async () => {
    const { s, calls, set } = setup([{ status: "exists" }]);
    set("2026-11-16T06:00:00Z");
    await s.tick();
    await s.tick();
    expect(calls).toEqual(["2026-11-16"]);
  });

  it("retries a failed or crashed run after the wait, not every minute", async () => {
    const { s, calls, logs, set } = setup([{ status: "failed" }, new Error("boom"), { status: "created" }]);
    set("2026-11-16T05:30:00Z");
    await s.tick();
    set("2026-11-16T05:45:00Z");
    await s.tick();
    expect(calls).toHaveLength(1);
    set("2026-11-16T06:01:00Z");
    await s.tick();
    set("2026-11-16T06:32:00Z");
    await s.tick();
    expect(calls).toHaveLength(3);
    expect(logs.join("\n")).toMatch(/failed; trying again in 30 minutes[\s\S]*threw: boom[\s\S]*created/);
  });
});
