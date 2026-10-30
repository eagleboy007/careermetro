import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { APP_EMAIL_DAILY_BUDGET, APP_EMAIL_DIGEST_SHARE } from "@/lib/schemas/constants";
import { appEmailsSent, giveBackAppEmail, takeAppEmail } from "./budget";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 8, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = NonNullable<Parameters<typeof takeAppEmail>[0]>["db"];

describe("the app-email budget's numbers", () => {
  it("keeps 60 of Resend's 100 a day for sign-in codes, and gives the digest at most half of the rest", () => {
    expect(APP_EMAIL_DAILY_BUDGET).toBe(40);
    expect(APP_EMAIL_DIGEST_SHARE).toBe(20);
    expect(APP_EMAIL_DIGEST_SHARE).toBeLessThan(APP_EMAIL_DAILY_BUDGET);
  });
});

describe.skipIf(!db)("the shared app-email budget (database)", () => {
  // A far-off India day of its own, so no other test or run shares the count. 01:00 UTC is 06:30 IST the same day.
  const at = new Date(Date.UTC(2100, 0, 1, 1) + (Date.now() % 20_000) * 86_400_000);
  const day = new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const d = () => db as unknown as Db;

  afterAll(async () => {
    await db!.delete(schema.appEmailDays).where(eq(schema.appEmailDays.day, day));
    await sqlClient!.end();
  });

  it("takes one at a time up to the cap, never past it even when many ask at once, and gives back without going below zero", async () => {
    expect(await appEmailsSent({ db: d(), now: at })).toBe(0);
    expect(await takeAppEmail({ db: d(), now: at, cap: 3 })).toBe(day);
    // Nine more at once: only two fit under a cap of 3.
    const taken = await Promise.all(Array.from({ length: 9 }, () => takeAppEmail({ db: d(), now: at, cap: 3 })));
    expect(taken.filter(Boolean)).toHaveLength(2);
    expect(await appEmailsSent({ db: d(), now: at })).toBe(3);
    expect(await takeAppEmail({ db: d(), now: at, cap: 3 })).toBeNull();
    // A bigger cap (the weekly email's whole budget) takes the rest; never more than the budget, whatever is asked.
    expect(await takeAppEmail({ db: d(), now: at, cap: 1_000 })).toBe(day);
    expect(await appEmailsSent({ db: d(), now: at })).toBe(4);
    expect(await takeAppEmail({ db: d(), now: at, cap: 0 })).toBeNull();
    await giveBackAppEmail(day, d());
    expect(await appEmailsSent({ db: d(), now: at })).toBe(3);
    await db!.update(schema.appEmailDays).set({ sent: APP_EMAIL_DAILY_BUDGET }).where(eq(schema.appEmailDays.day, day));
    expect(await takeAppEmail({ db: d(), now: at, cap: 1_000 })).toBeNull();
    await db!.update(schema.appEmailDays).set({ sent: 0 }).where(eq(schema.appEmailDays.day, day));
    await giveBackAppEmail(day, d());
    expect(await appEmailsSent({ db: d(), now: at })).toBe(0);
  });
});
