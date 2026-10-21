import { inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { liveMarketInputs } from "./live-store";

vi.mock("server-only", () => ({}));

// The reads behind live counts on /market against a real Postgres with migrations applied. Synthetic posts and rollup
// rows under this run's own board token and role slugs, so other test files sharing the database don't disturb it.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 3, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("live market reads (database)", () => {
  const run = `mkt${Date.now()}`;
  const role = `${run}-role`;
  const rollupIds: string[] = [];
  let n = 0;
  const now = new Date("2026-12-10T06:00:00Z");
  const post = (over: Partial<typeof schema.jobPosts.$inferInsert> = {}) => ({
    ats: "lever" as const,
    boardToken: run,
    externalId: `${run}-${n++}`,
    url: "https://jobs.lever.co/example/1",
    title: "Junior data analyst",
    company: "Example Labs",
    city: "Kochi",
    experienceNote: "2 to 4 years",
    roleSlug: role,
    ...over,
  });

  afterAll(async () => {
    await db!.delete(schema.jobPosts).where(like(schema.jobPosts.boardToken, `${run}%`));
    if (rollupIds.length) await db!.delete(schema.marketOpeningsMonthly).where(inArray(schema.marketOpeningsMonthly.id, rollupIds));
    await sqlClient?.end();
  });

  it("groups open posts by role, city and note, and reads the rollup's state rows for the trend's months as text dates", async () => {
    await db!.insert(schema.jobPosts).values([
      post(),
      post(),
      post({ experienceNote: null }),
      post({ closedAt: new Date("2026-12-01T00:00:00Z") }),
      post({ roleSlug: null }),
    ]);
    const rows = await db!
      .insert(schema.marketOpeningsMonthly)
      .values([
        { month: "2026-11-01", roleSlug: role, state: "KL", newPosts: 4, openAtEnd: 2 },
        { month: "2026-11-01", roleSlug: role, state: "KL", city: "Kochi", newPosts: 4, openAtEnd: 2 },
        { month: "2025-01-01", roleSlug: role, state: "KL", newPosts: 9, openAtEnd: 1 },
      ])
      .returning({ id: schema.marketOpeningsMonthly.id });
    rollupIds.push(...rows.map((r) => r.id));

    const read = await liveMarketInputs({ db: db!, now });
    const mine = read.open.filter((g) => g.roleSlug === role).sort((a, b) => String(a.experienceNote).localeCompare(String(b.experienceNote)));
    expect(mine).toEqual([
      { roleSlug: role, city: "Kochi", experienceNote: "2 to 4 years", posts: 2 },
      { roleSlug: role, city: "Kochi", experienceNote: null, posts: 1 },
    ]);
    expect(read.open.every((g) => typeof g.roleSlug === "string" && typeof g.posts === "number")).toBe(true);
    // State rows only, and only from the window the trend reads (13 months back).
    expect(read.rollup.filter((r) => r.roleSlug === role)).toEqual([{ month: "2026-11-01", roleSlug: role, state: "KL", band: null, newPosts: 4 }]);
    expect(read.firstMonth).toMatch(/^\d{4}-\d{2}-01$/);
    expect(read.firstMonth! <= "2025-01-01").toBe(true);
  });

  /**
   * T122: runs `read` while another connection holds an access exclusive lock on market_openings_monthly (a migration
   * or a stuck rollup would), and gives what it settled with, or "hung" if it hadn't after 5 s.
   */
  async function whileLocked(read: () => Promise<unknown>): Promise<{ ms: number; outcome: unknown }> {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const held = new Promise<void>((r) => (locked = r));
    const holder = sqlClient!.begin(async (tx) => {
      await tx`lock table market_openings_monthly in access exclusive mode`;
      locked();
      await gate;
    });
    await held;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        read().then(
          () => "read",
          (error: unknown) => error,
        ),
        new Promise<"hung">((r) => (timer = setTimeout(() => r("hung"), 5000))),
      ]);
      return { ms: Date.now() - started, outcome };
    } finally {
      clearTimeout(timer);
      release();
      await holder;
    }
  }
  const code = (outcome: unknown) => (outcome as { cause?: { code?: string } } | null)?.cause?.code;

  it("fails on the lock limit (55P03) instead of waiting while the rollup is locked", async () => {
    const { ms, outcome } = await whileLocked(() => liveMarketInputs({ db: db!, now, timeouts: { statementMs: 3000, lockMs: 300 } }));
    expect(outcome).toBeInstanceOf(Error);
    expect(code(outcome)).toBe("55P03");
    expect(ms).toBeLessThan(2500);
  });

  it("fails on the statement limit (57014) when no lock limit is set", async () => {
    const { ms, outcome } = await whileLocked(() => liveMarketInputs({ db: db!, now, timeouts: { statementMs: 300, lockMs: 0 } }));
    expect(outcome).toBeInstanceOf(Error);
    expect(code(outcome)).toBe("57014");
    expect(ms).toBeLessThan(2500);
  });

  it("reads normally again once the lock is gone, with the limits gone with the transaction", async () => {
    const setting = async () => (await db!.execute<{ statement_timeout: string }>(sql`show statement_timeout`))[0]?.statement_timeout;
    const before = await setting();
    const read = await liveMarketInputs({ db: db!, now, timeouts: { statementMs: 300, lockMs: 100 } });
    expect(Array.isArray(read.open)).toBe(true);
    // SET LOCAL ended with the transaction: the pool's connections keep the server's default.
    expect(await setting()).toBe(before);
    expect(before).not.toBe("300ms");
  });
});
