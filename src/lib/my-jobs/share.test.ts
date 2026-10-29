import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { clearOldSharedJobs, holdSharedJob, isHoldId, takeSharedJob } from "./share";

const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = Parameters<typeof holdSharedJob>[2];

const JOB = { text: "Monitor alerts in Microsoft Sentinel and triage phishing reports.", url: "https://careers.example.com/soc" };

describe("hold ids", () => {
  it("takes a uuid only", () => {
    expect(isHoldId("6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f")).toBe(true);
    expect(isHoldId("limit")).toBe(false);
    expect(isHoldId(["6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f"])).toBe(false);
  });
});

describe.skipIf(!db)("jobs shared from the phone (database)", () => {
  const run = `share${Date.now()}`;
  const userIds: string[] = [];
  const holdIds: string[] = [];
  const d = () => db as unknown as Db;
  const person = async () => {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${userIds.length}@example.test` }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  };
  const hold = async (userId: string | null) => {
    const id = await holdSharedJob(JOB, userId, d());
    holdIds.push(id);
    return id;
  };

  afterAll(async () => {
    if (holdIds.length) await db!.delete(schema.sharedJobHolds).where(inArray(schema.sharedJobHolds.id, holdIds));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  it("opens once, in the browser holding its cookie", async () => {
    const id = await hold(null);
    const someone = await person();
    expect(await takeSharedJob(id, { userId: someone, cookie: null }, d())).toBeNull();
    expect(await takeSharedJob(id, { userId: null, cookie: "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f" }, d())).toBeNull();
    expect(await takeSharedJob(id, { userId: someone, cookie: id }, d())).toEqual(JOB);
    expect(await takeSharedJob(id, { userId: someone, cookie: id }, d())).toBeNull();
  });

  it("opens for the person who shared it signed in, without the cookie, and for no one else", async () => {
    const owner = await person();
    const other = await person();
    const id = await hold(owner);
    expect(await takeSharedJob(id, { userId: other, cookie: null }, d())).toBeNull();
    expect(await takeSharedJob(id, { userId: owner, cookie: null }, d())).toEqual(JOB);
  });

  it("is refused after an hour, and the daily cleanup deletes it", async () => {
    const id = await hold(null);
    const later = new Date(Date.now() + 61 * 60_000);
    expect(await takeSharedJob(id, { userId: null, cookie: id }, d(), later)).toBeNull();
    expect((await clearOldSharedJobs(d(), later)).sharedJobsCleared).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.sharedJobHolds).where(eq(schema.sharedJobHolds.id, id))).toEqual([]);
  });

  it("refuses a link that isn't https or a text over 12,000 characters", async () => {
    await expect(holdSharedJob({ text: "x", url: "http://example.com/job" }, null, d())).rejects.toThrow();
    await expect(holdSharedJob({ text: "x".repeat(12_001), url: "" }, null, d())).rejects.toThrow();
  });

  it("goes with the account", async () => {
    const owner = await person();
    const id = await hold(owner);
    await db!.delete(schema.users).where(eq(schema.users.id, owner));
    expect(await db!.select().from(schema.sharedJobHolds).where(eq(schema.sharedJobHolds.id, id))).toEqual([]);
  });
});
