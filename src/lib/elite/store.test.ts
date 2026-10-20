import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { ELITE_CHANGES_PER_DAY } from "@/lib/schemas";
import { eliteBadgeFor, eliteMessage, eliteNeeded, eliteOn, planFor, setElite, setEliteBadge } from "./store";

vi.mock("server-only", () => ({}));

// Elite, free in the beta (FR-50), against a real Postgres with migrations applied. Every person here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("elite store (database)", () => {
  const run = `elite${Date.now()}`;
  const userIds: string[] = [];
  let n = 0;
  const person = async () => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  };
  const rowOf = async (id: string) => (await db!.select().from(schema.userPlans).where(eq(schema.userPlans.userId, id)))[0];

  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient?.end();
  });

  it("starts everyone on Free, with no row, and an Elite action says to turn it on", async () => {
    const me = await person();
    expect(await eliteOn(me, db!)).toBe(false);
    expect(await planFor(me, db!)).toEqual({ elite: false, badgeShown: false, since: null });
    expect(await eliteNeeded(me, db!)).toBe("Turn on Elite to use this.");
    expect(await setEliteBadge(me, true, { db: db! })).toEqual({ ok: false, error: "not_elite" });
    expect(eliteMessage("not_elite")).toBe("Turn on Elite to use this.");
    expect(await rowOf(me)).toBeUndefined();
  });

  it("turns Elite on and off for that person only, keeps the first date, and turning off keeps the row as Free", async () => {
    const me = await person();
    const other = await person();
    const first = new Date("2026-10-19T06:00:00Z");
    const on = await setElite(me, true, { db: db!, now: first });
    expect(on).toEqual({ ok: true, plan: { elite: true, badgeShown: false, since: "19 Oct 2026" } });
    expect(await eliteOn(me, db!)).toBe(true);
    expect(await eliteNeeded(me, db!)).toBeNull();
    expect(await eliteOn(other, db!)).toBe(false);
    // Again the next day: still since the first day.
    expect(await setElite(me, true, { db: db!, now: new Date("2026-10-20T06:00:00Z") })).toMatchObject({ ok: true, plan: { since: "19 Oct 2026" } });

    expect(await setEliteBadge(me, true, { db: db! })).toEqual({ ok: true, plan: { elite: true, badgeShown: true, since: "19 Oct 2026" } });
    expect(await eliteBadgeFor(me, db!)).toBe(true);
    expect(await eliteBadgeFor(other, db!)).toBe(false);

    expect(await setElite(me, false, { db: db! })).toEqual({ ok: true, plan: { elite: false, badgeShown: false, since: null } });
    expect(await rowOf(me)).toMatchObject({ eliteSince: null, badgeShown: false });
    expect(await eliteBadgeFor(me, db!)).toBe(false);
    // Turning off with no row writes nothing.
    expect(await setElite(other, false, { db: db! })).toMatchObject({ ok: true, plan: { elite: false } });
    expect(await rowOf(other)).toBeUndefined();
  });

  it("refuses anything but true or false", async () => {
    const me = await person();
    expect(await setElite(me, "true", { db: db! })).toEqual({ ok: false, error: "invalid" });
    expect(await setEliteBadge(me, 1, { db: db! })).toEqual({ ok: false, error: "invalid" });
    expect(await eliteOn(me, db!)).toBe(false);
  });

  it("allows 10 changes a day per person, then says so and changes nothing", async () => {
    const me = await person();
    for (let i = 0; i < ELITE_CHANGES_PER_DAY; i++) expect((await setElite(me, i % 2 === 0, { db: db! })).ok).toBe(true);
    // The tenth was "off", so the eleventh, "on", is refused and the person stays on Free.
    expect(await setElite(me, true, { db: db! })).toEqual({ ok: false, error: "limit" });
    expect(eliteMessage("limit")).toMatch(/Try again tomorrow/);
    expect(await eliteOn(me, db!)).toBe(false);
  });

  it("is in Download your data, and goes with the account", async () => {
    const me = await person();
    const never = await person();
    await setElite(me, true, { db: db!, now: new Date("2026-10-19T06:00:00Z") });
    await setEliteBadge(me, true, { db: db! });
    const data = (await exportAccountData(me, db!))!;
    expect(EXPORT_VERSION).toBe(29);
    expect(data.exportVersion).toBe(29);
    expect(data.plan).toMatchObject({ plan: "elite", eliteSince: new Date("2026-10-19T06:00:00Z"), badgeShown: true });
    expect((await exportAccountData(never, db!))!.plan).toBeNull();
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await rowOf(me)).toBeUndefined();
  });
});
