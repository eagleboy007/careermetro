import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCurrent, latestMigration, waitForMigrations } from "../../scripts/wait-for-migrations.mjs";

const clock = () => {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};
const quiet = () => {};

describe("latestMigration", () => {
  it("reads the newest timestamp from the real journal", () => {
    const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"));
    const newest = Math.max(...journal.entries.map((e: { when: number }) => e.when));
    expect(latestMigration(journal)).toBe(newest);
  });

  it("is 0 for an empty journal", () => {
    expect(latestMigration({ entries: [] })).toBe(0);
    expect(latestMigration(undefined)).toBe(0);
  });
});

describe("isCurrent", () => {
  it("compares the newest applied migration with the build's", () => {
    expect(isCurrent(200, 200)).toBe(true);
    expect(isCurrent(200, 300)).toBe(true);
    expect(isCurrent(200, 100)).toBe(false);
    expect(isCurrent(200, null)).toBe(false);
    expect(isCurrent(0, null)).toBe(true);
  });
});

describe("waitForMigrations", () => {
  it("returns at once when the database is current", async () => {
    const c = clock();
    let reads = 0;
    const result = await waitForMigrations({ latest: 5, readApplied: async () => (reads++, 5), timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet });
    expect(result).toBe("current");
    expect(reads).toBe(1);
  });

  it("waits until the migration lands", async () => {
    const c = clock();
    const answers = [3, 3, 5];
    const result = await waitForMigrations({ latest: 5, readApplied: async () => answers.shift()!, timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet });
    expect(result).toBe("current");
    expect(c.now()).toBe(20_000);
  });

  it("gives up as behind after the time limit", async () => {
    const c = clock();
    const result = await waitForMigrations({ latest: 5, readApplied: async () => 3, timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet });
    expect(result).toBe("behind");
    expect(c.now()).toBe(60_000);
  });

  it("keeps waiting while the migrations table doesn't exist yet", async () => {
    const c = clock();
    const answers: (number | Error)[] = [Object.assign(new Error("x"), { code: "42P01" }), Object.assign(new Error("x"), { code: "42P01" }), Object.assign(new Error("x"), { code: "42P01" }), 5];
    const readApplied = async () => {
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    };
    expect(await waitForMigrations({ latest: 5, readApplied, timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet })).toBe("current");
  });

  it("reports an error, not behind, when the table is still missing at the deadline", async () => {
    const c = clock();
    const readApplied = async () => {
      throw Object.assign(new Error("x"), { code: "42P01" });
    };
    expect(await waitForMigrations({ latest: 5, readApplied, timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet })).toBe("error");
  });

  it("stops after three other read errors, and never logs the error message", async () => {
    const c = clock();
    const lines: string[] = [];
    const readApplied = async () => {
      throw Object.assign(new Error("password authentication failed for postgres://user:secret@host"), { code: "28P01" });
    };
    expect(await waitForMigrations({ latest: 5, readApplied, timeoutMs: 600_000, intervalMs: 10_000, ...c, log: (l: string) => lines.push(l) })).toBe("error");
    expect(lines.join("\n")).not.toContain("secret");
    expect(lines.join("\n")).toContain("28P01");
  });
});
