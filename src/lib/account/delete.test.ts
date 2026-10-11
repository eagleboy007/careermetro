import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { DELETE_GRACE_DAYS, purgeDeletedAccounts, requestDeletion, restoreAccount, restoreUntil } from "./delete";
import { exportAccountData } from "./export";
import { findAccount, saveNames } from "./store";

// Runs against a real Postgres with migrations applied.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const DAY = 86_400_000;

describe.skipIf(!db)("account settings: names, download and delete (database)", () => {
  const run = `del-${Date.now()}`;
  const userIds: string[] = [];
  let n = 0;

  async function seedUser() {
    const [user] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Rao" })
      .returning({ id: schema.users.id, authSubject: schema.users.authSubject });
    userIds.push(user.id);
    const [consent] = await db!.insert(schema.consents).values({ userId: user.id, purpose: "upload", policyVersion: "v" }).returning();
    const [resume] = await db!
      .insert(schema.resumes)
      .values({ userId: user.id, mimeType: "text/plain", sizeBytes: 10, status: "parsed", consentId: consent.id, nameHashes: ["h1"], clientHash: "c1" })
      .returning();
    const data = { headline: "Analyst", totalYearsExperience: 2, roles: [], skills: [], education: [], certifications: [] };
    await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data, confirmedByUser: true });
    await db!.insert(schema.rideDays).values({ userId: user.id, day: "2026-10-01", taskIds: ["t1"] });
    return { ...user, resumeId: resume.id };
  }

  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  it("saves first and last name and the full name made from them", async () => {
    const { id, authSubject } = await seedUser();
    expect(await saveNames(id, "  Asha ", " Rao  Kumar ", db!)).toBe(true);
    expect(await findAccount(authSubject!, db!)).toMatchObject({ firstName: "Asha", lastName: "Rao Kumar", name: "Asha Rao Kumar" });
    expect(await saveNames(id, "   ", "Rao", db!)).toBe(false);
    expect(await saveNames(id, "Asha", "", db!)).toBe(true);
    expect(await findAccount(authSubject!, db!)).toMatchObject({ firstName: "Asha", lastName: null, name: "Asha" });
  });

  it("downloads the account's own data, with no keyed hashes", async () => {
    const { id } = await seedUser();
    const data = await exportAccountData(id, db!);
    expect(data?.account.email).toMatch(/@example\.com$/);
    expect(data?.resumes).toHaveLength(1);
    expect(data?.resumes[0].profiles[0]).toMatchObject({ version: 1, confirmedByUser: true, data: { headline: "Analyst" } });
    expect(data?.rideDays).toEqual([{ day: "2026-10-01", tasks: ["t1"] }]);
    expect(data?.consents).toEqual([expect.objectContaining({ purpose: "upload" })]);
    const text = JSON.stringify(data);
    for (const hidden of ["h1", "c1", "nameHashes", "clientHash", "authSubject"]) expect(text).not.toContain(hidden);
    expect(await exportAccountData("00000000-0000-4000-8000-000000000000", db!)).toBeNull();
  });

  it("hides a deleted account, restores it within 30 days, and logs no one", async () => {
    const { id, authSubject } = await seedUser();
    const now = new Date();
    expect(await requestDeletion(id, db!, now)).toBe(true);
    expect(await requestDeletion(id, db!, now)).toBe(false);
    const account = await findAccount(authSubject!, db!);
    expect(account?.deletionRequestedAt?.getTime()).toBe(now.getTime());
    expect(restoreUntil(account!.deletionRequestedAt)!.getTime()).toBe(now.getTime() + DELETE_GRACE_DAYS * DAY);
    expect(await restoreAccount(id, db!)).toBe(true);
    expect((await findAccount(authSubject!, db!))?.deletionRequestedAt).toBeNull();
    const logs = await db!.select().from(schema.auditLogs).where(inArray(schema.auditLogs.action, ["account_delete_requested", "account_restored"]));
    for (const l of logs) expect(`${l.actor}${l.target}`).not.toMatch(new RegExp(`${id}|${run}`));
  });

  it("won't restore past 30 days, and the daily job then removes everything for good", async () => {
    const kept = await seedUser();
    const gone = await seedUser();
    const now = new Date();
    await requestDeletion(kept.id, db!, new Date(now.getTime() - 29 * DAY));
    await requestDeletion(gone.id, db!, new Date(now.getTime() - 31 * DAY));
    expect(await restoreAccount(gone.id, db!, now)).toBe(false);

    const before = await db!.select({ n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(eq(schema.auditLogs.action, "account_deleted"));
    expect(await purgeDeletedAccounts(db!, now)).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.users).where(eq(schema.users.id, gone.id))).toEqual([]);
    expect(await db!.select().from(schema.resumes).where(eq(schema.resumes.id, gone.resumeId))).toEqual([]);
    expect(await db!.select().from(schema.rideDays).where(eq(schema.rideDays.userId, gone.id))).toEqual([]);
    expect(await db!.select().from(schema.consents).where(eq(schema.consents.userId, gone.id))).toEqual([]);
    const after = await db!.select({ n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(eq(schema.auditLogs.action, "account_deleted"));
    expect(after[0].n).toBeGreaterThan(before[0].n);

    // Still within its 30 days: kept, and can come back.
    expect(await db!.select().from(schema.resumes).where(eq(schema.resumes.id, kept.resumeId))).toHaveLength(1);
    expect(await restoreAccount(kept.id, db!, now)).toBe(true);
  });

  it("removes the Supabase sign-in too, when the database has one", async () => {
    // A stand-in for Supabase's auth.users, dropped again below.
    await db!.execute(sql`create schema if not exists auth`);
    await db!.execute(sql`create table if not exists auth.users (id uuid primary key)`);
    try {
      const subject = crypto.randomUUID();
      const [user] = await db!.insert(schema.users).values({ email: `${run}-auth@example.com`, authSubject: subject }).returning({ id: schema.users.id });
      userIds.push(user.id);
      await db!.execute(sql`insert into auth.users (id) values (${subject}::uuid)`);
      await requestDeletion(user.id, db!, new Date(Date.now() - 31 * DAY));
      await purgeDeletedAccounts(db!);
      const left = await db!.execute(sql`select id from auth.users where id = ${subject}::uuid`);
      expect([...left]).toEqual([]);
    } finally {
      await db!.execute(sql`drop schema auth cascade`);
    }
  });
});
