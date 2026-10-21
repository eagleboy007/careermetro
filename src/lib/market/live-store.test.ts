import { inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { liveMarketInputs } from "./live-store";

vi.mock("server-only", () => ({}));

// The reads behind live counts on /market against a real Postgres with migrations applied. Synthetic posts and rollup
// rows under this run's own board token and role slugs, so other test files sharing the database don't disturb it.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
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
});
