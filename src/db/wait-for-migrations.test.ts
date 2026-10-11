import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    expect(isCurrent(200, { max: 200, count: 9 }, 9)).toBe(true);
    expect(isCurrent(200, { max: 300, count: 10 }, 9)).toBe(true);
    expect(isCurrent(200, { max: 100, count: 9 }, 9)).toBe(false);
    expect(isCurrent(200, null, 9)).toBe(false);
    expect(isCurrent(0, null)).toBe(true);
  });

  it("is behind when a migration was skipped, even with the newest one applied", () => {
    expect(isCurrent(200, { max: 200, count: 8 }, 9)).toBe(false);
  });
});

describe("waitForMigrations", () => {
  it("returns at once when the database is current", async () => {
    const c = clock();
    let reads = 0;
    const result = await waitForMigrations({ latest: 5, readApplied: async () => (reads++, { max: 5, count: 1 }), timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet });
    expect(result).toBe("current");
    expect(reads).toBe(1);
  });

  it("waits until the migration lands", async () => {
    const c = clock();
    const answers = [{ max: 3, count: 1 }, { max: 3, count: 1 }, { max: 5, count: 1 }];
    const result = await waitForMigrations({ latest: 5, readApplied: async () => answers.shift()!, timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet });
    expect(result).toBe("current");
    expect(c.now()).toBe(20_000);
  });

  it("gives up as behind after the time limit", async () => {
    const c = clock();
    const result = await waitForMigrations({ latest: 5, readApplied: async () => ({ max: 3, count: 1 }), timeoutMs: 60_000, intervalMs: 10_000, ...c, log: quiet });
    expect(result).toBe("behind");
    expect(c.now()).toBe(60_000);
  });

  it("keeps waiting while the migrations table doesn't exist yet", async () => {
    const c = clock();
    const answers: ({ max: number; count: number } | Error)[] = [Object.assign(new Error("x"), { code: "42P01" }), Object.assign(new Error("x"), { code: "42P01" }), Object.assign(new Error("x"), { code: "42P01" }), { max: 5, count: 1 }];
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

describe("the script", () => {
  const run = (env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [resolve(__dirname, "../../scripts/wait-for-migrations.mjs")], {
      env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    return `${r.stdout}${r.stderr}status=${r.status}`;
  };

  it.each(["postgres://user:p@ss:word@[bad host/db", "not a url secretpass", "postgres://user:50%off@host/db"])(
    "never prints a malformed DATABASE_URL (%s) and doesn't block the deploy",
    (url) => {
      const out = run({ VERCEL_ENV: "production", DATABASE_URL: url, MIGRATION_WAIT_MS: "1" });
      expect(out).not.toContain("secretpass");
      expect(out).not.toContain("p@ss");
      expect(out).not.toContain("50%off");
      expect(out).not.toContain("status=1");
    },
  );

  it("warns when Vercel doesn't expose VERCEL_ENV", () => {
    expect(run({ VERCEL: "1" })).toContain("VERCEL_ENV is missing");
  });
});
