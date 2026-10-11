import { and, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { allowsShared, takeShared, type SharedLimit } from "./shared-limit";

// Runs against a real Postgres with migrations applied. Each test uses its own bucket.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

let n = 0;
const limit = (max: number, windowMs = 60_000): SharedLimit => ({ bucket: `test-limit-${Date.now()}-${n++}`, max, windowMs });

describe.skipIf(!db)("shared rate limits (database)", () => {
  afterAll(async () => {
    await db!.delete(schema.rateLimits).where(like(schema.rateLimits.bucket, "test-limit-%"));
    await sqlClient!.end();
  });

  it("allows up to the limit per key in a window, keys apart, and again in the next window", async () => {
    const l = limit(2);
    const at = 1_000_000_020_000;
    const take = (key: string, now = at) => takeShared(l, key, { db: db!, now });
    expect([await take("a"), await take("a"), await take("a")]).toEqual([true, true, false]);
    expect(await allowsShared(l, "a", { db: db!, now: at })).toBe(false);
    expect(await take("b")).toBe(true);
    expect(await take("a", at + 60_000)).toBe(true);
  });

  it("never lets parallel requests past the limit, whichever server they hit", async () => {
    const l = limit(5);
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 20 }, () => takeShared(l, "203.0.113.7", { db: db!, now })));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("stores a keyed hash, never the email or IP", async () => {
    const l = limit(5);
    await takeShared(l, "asha@example.com", { db: db! });
    const rows = await db!.select().from(schema.rateLimits).where(eq(schema.rateLimits.bucket, l.bucket));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("asha");
    expect(rows[0].keyHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("lets the request through and logs when the database can't be reached", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { insert: () => { throw new Error("connect ECONNREFUSED"); }, select: () => { throw new Error("connect ECONNREFUSED"); } } as never;
    expect(await takeShared(limit(1), "k", { db: broken })).toBe(true);
    expect(await allowsShared(limit(1), "k", { db: broken })).toBe(true);
    expect(errors.mock.calls.join(" ")).toContain("rate_limit_unavailable");
    errors.mockRestore();
  });

  it("forgets windows older than two days", async () => {
    const l = limit(1, 60_000);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    await takeShared(l, "old", { db: db!, now: Date.now() - 3 * 24 * 3600_000 });
    random.mockReturnValue(0);
    await takeShared(l, "new", { db: db! });
    random.mockRestore();
    const rows = await db!.select().from(schema.rateLimits).where(and(eq(schema.rateLimits.bucket, l.bucket)));
    expect(rows).toHaveLength(1);
  });
});
