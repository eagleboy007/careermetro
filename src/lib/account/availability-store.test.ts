import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { AVAILABILITY_SAVES_PER_DAY } from "@/lib/schemas/constants";
import { AVAILABILITY_MESSAGES, exportAvailability, saveUsuallyFree, usuallyFreeFor } from "./availability-store";

vi.mock("server-only", () => ({}));

// Usually free (docs/plans/settings-columns-plan.md, FR-55) against a real Postgres with migrations applied. Every person
// here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("usually free store (database)", () => {
  const run = `usuallyfree${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  const now = new Date("2026-10-20T08:30:00Z");
  const person = async () => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  };
  const rowOf = async (id: string) => (await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, id)))[0];

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient?.end();
    // The hours never reach a log.
    expect(lines.join("\n")).not.toMatch(/mon 1|usually_free|Asha/);
  });

  it("starts Not set with no row, and a first save keeps a new user's other defaults", async () => {
    const me = await person();
    expect(await usuallyFreeFor(me, db!)).toEqual([]);
    expect(await rowOf(me)).toBeUndefined();
    expect(await saveUsuallyFree(me, ["tue 10:00", "mon 18:00", "mon 17:00"], { db: db!, now })).toEqual({
      ok: true,
      usuallyFree: ["mon 17:00", "mon 18:00", "tue 10:00"],
    });
    expect(await rowOf(me)).toMatchObject({
      usuallyFree: ["mon 17:00", "mon 18:00", "tue 10:00"],
      messageRequests: true,
      openToWorkIn: [],
      profileVisibility: "connections",
      companiesCanFind: false,
      jobSearch: true,
    });
  });

  it("saves only the person's own row, replaces the whole grid, and clears it", async () => {
    const me = await person();
    const other = await person();
    await saveUsuallyFree(other, ["fri 15:00"], { db: db!, now });
    await saveUsuallyFree(me, ["mon 10:00", "wed 12:00"], { db: db!, now });
    expect(await saveUsuallyFree(me, ["thu 14:00"], { db: db!, now })).toEqual({ ok: true, usuallyFree: ["thu 14:00"] });
    expect(await usuallyFreeFor(other, db!)).toEqual(["fri 15:00"]);
    expect(await saveUsuallyFree(me, [], { db: db!, now })).toEqual({ ok: true, usuallyFree: [] });
    expect(await usuallyFreeFor(me, db!)).toEqual([]);
  });

  it("refuses what the grid can't send, and the database holds the same line", async () => {
    const me = await person();
    for (const bad of [["sat 10:00"], ["mon 13:00"], ["mon 10:00", "mon 10:00"], "mon 10:00", null])
      expect(await saveUsuallyFree(me, bad, { db: db!, now })).toEqual({ ok: false, error: "invalid" });
    expect(AVAILABILITY_MESSAGES.invalid).toMatch(/try again/);
    await saveUsuallyFree(me, ["mon 10:00"], { db: db!, now });
    await expect(db!.execute(sql`update user_settings set usually_free = '{"sun 10:00"}' where user_id = ${me}`)).rejects.toThrow();
    expect(await usuallyFreeFor(me, db!)).toEqual(["mon 10:00"]);
  });

  it(`allows ${AVAILABILITY_SAVES_PER_DAY} saves a day per person, then says so and saves nothing`, async () => {
    const me = await person();
    for (let i = 0; i < AVAILABILITY_SAVES_PER_DAY; i++) expect((await saveUsuallyFree(me, i % 2 ? ["mon 10:00"] : [], { db: db!, now })).ok).toBe(true);
    expect(await saveUsuallyFree(me, ["fri 18:00"], { db: db!, now })).toEqual({ ok: false, error: "limit" });
    expect(AVAILABILITY_MESSAGES.limit).toMatch(/Try again tomorrow/);
    expect(await usuallyFreeFor(me, db!)).toEqual(["mon 10:00"]);
    // The next day starts again.
    expect((await saveUsuallyFree(me, ["fri 18:00"], { db: db!, now: new Date(now.getTime() + 25 * 3600_000) })).ok).toBe(true);
  });

  it("is in Download your data (version 32), and goes with the account", async () => {
    const me = await person();
    const never = await person();
    await saveUsuallyFree(me, ["mon 17:00", "mon 18:00"], { db: db!, now });
    const data = (await exportAccountData(me, db!))!;
    expect(EXPORT_VERSION).toBe(32);
    expect(data.exportVersion).toBe(32);
    expect(data.availability).toEqual({ usuallyFree: ["mon 17:00", "mon 18:00"] });
    expect(await exportAvailability(never, db!)).toEqual({ usuallyFree: [] });
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await rowOf(me)).toBeUndefined();
  });
});
