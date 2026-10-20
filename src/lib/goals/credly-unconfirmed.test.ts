import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { skills } from "@/content";
import { provedSkills, reopenUnconfirmedGoals } from "./store";

vi.mock("server-only", () => ({}));

// Review B2: certificates saved before a Credly badge had to be confirmed (migration 0029 and the job that brings their
// goals in line), against a real Postgres with migrations applied. Every person here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const MIGRATION = readFileSync(resolve(__dirname, "../../../drizzle/0029_credly_unconfirmed.sql"), "utf8");
const noGroups = new Map<string, string[]>();

/**
 * The migration's statements, each kept to these people: tests share one database with other files running at the
 * same time. Only the first WHERE of each statement (its own table) is narrowed; the SQL is otherwise as shipped.
 */
const scoped = (ids: string[]) =>
  MIGRATION.replace(/--[^\n]*/g, "")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\bWHERE\b/, `WHERE "user_id" IN (${ids.map((id) => `'${id}'`).join(", ")}) AND`));

describe.skipIf(!db)("certificates saved before Credly had to confirm them (database)", () => {
  const run = `cu-${Date.now()}`;
  const userIds: string[] = [];
  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  /** A person whose AWS goal is met by one accepted certificate, as code before this fix saved it. */
  async function before(n: string, over: { url: string; verifier?: "credly" | null; badgeId?: string | null; checkNote?: "earner_name" | "expired" | null }) {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, firstName: "Priya", lastName: "Sharma" }).returning({ id: schema.users.id });
    userIds.push(u.id);
    const [goal] = await db!.insert(schema.userGoals).values({ userId: u.id, skillId: "aws", position: 1, status: "met", metAt: new Date() }).returning({ id: schema.userGoals.id });
    const key = `${run}-${n}-key`;
    await db!.insert(schema.certificateCredentials).values({ certId: "aws-cloud-practitioner", credentialKey: key, userId: u.id });
    const [p] = await db!
      .insert(schema.gapProofs)
      .values({
        userId: u.id,
        skillId: "aws",
        type: "certification",
        status: "accepted",
        evidence: { type: "certification", certId: "aws-cloud-practitioner", issuer: "Amazon Web Services", url: over.url },
        certId: "aws-cloud-practitioner",
        issuedOn: "2025-03-01",
        expiresOn: "2028-03-01",
        credentialKey: key,
        nameMatched: true,
        verifier: over.verifier ?? null,
        verifiedAt: new Date(),
        badgeId: over.badgeId ?? null,
        checkNote: over.checkNote ?? null,
      })
      .returning({ id: schema.gapProofs.id });
    return { userId: u.id, goalId: goal.id, proofId: p.id, key };
  }
  const proof = async (id: string) => (await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.id, id)))[0];
  const goalStatus = async (id: string) => (await db!.select({ status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.id, id)))[0].status;
  const credentials = (userId: string) => db!.select().from(schema.certificateCredentials).where(eq(schema.certificateCredentials.userId, userId));
  const badge = (n: string) => `c4ed1100-0000-4000-8000-${n.padStart(12, "0")}`;

  it("stops unconfirmed Credly badges counting, refuses another earner's, and reopens their goals; the rest stay", async () => {
    const unchecked = await before("unchecked", { url: `https://www.credly.com/badges/${badge("b201")}`, badgeId: badge("b201") });
    const expiredNote = await before("expired-note", { url: `https://www.credly.com/badges/${badge("b202")}`, badgeId: badge("b202"), checkNote: "expired" });
    const noId = await before("no-id", { url: "https://www.credly.com/badges/walk-test" });
    const otherName = await before("other-name", { url: `https://www.credly.com/badges/${badge("b203")}`, badgeId: badge("b203"), checkNote: "earner_name" });
    const verified = await before("verified", { url: `https://www.credly.com/badges/${badge("b204")}`, badgeId: badge("b204"), verifier: "credly" });
    const microsoft = await before("microsoft", { url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/B2" });
    const all = [unchecked, expiredNote, noId, otherName, verified, microsoft];
    const ids = all.map((p) => p.userId);
    for (const p of all) expect(await provedSkills(p.userId, db! as never, "2026-10-15")).toEqual(["aws"]);

    for (const statement of scoped(ids)) await db!.execute(sql.raw(statement));

    for (const p of [unchecked, expiredNote, noId]) expect(await proof(p.proofId)).toMatchObject({ status: "pending", heldReason: "credly_check", verifiedAt: null });
    expect(await proof(otherName.proofId)).toMatchObject({ status: "rejected", heldReason: null, checkNote: "earner_name" });
    expect(await credentials(otherName.userId)).toEqual([]);
    expect(await credentials(unchecked.userId)).toHaveLength(1);
    expect(await proof(verified.proofId)).toMatchObject({ status: "accepted", verifier: "credly" });
    expect(await proof(microsoft.proofId)).toMatchObject({ status: "accepted", verifier: null });
    // Companies read proof, so they see Not yet at once.
    for (const p of [unchecked, expiredNote, noId, otherName]) expect(await provedSkills(p.userId, db! as never, "2026-10-15")).toEqual([]);

    // The goals follow with the job, each under the person's lock.
    expect(await reopenUnconfirmedGoals(db! as never, noGroups, ids)).toBe(4);
    for (const p of [unchecked, expiredNote, noId, otherName]) expect(await goalStatus(p.goalId)).toBe("active");
    for (const p of [verified, microsoft]) expect(await goalStatus(p.goalId)).toBe("met");

    // Running both again changes nothing.
    for (const statement of scoped(ids)) await db!.execute(sql.raw(statement));
    expect(await reopenUnconfirmedGoals(db! as never, noGroups, ids)).toBe(0);
    for (const p of [unchecked, expiredNote, noId, otherName]) expect(await goalStatus(p.goalId)).toBe("active");
    for (const p of [verified, microsoft]) expect(await goalStatus(p.goalId)).toBe("met");
  });

  it("keeps a goal met when another current proof still covers it", async () => {
    const p = await before("covered", { url: `https://www.credly.com/badges/${badge("b205")}`, badgeId: badge("b205") });
    await db!.insert(schema.gapProofs).values({
      userId: p.userId,
      skillId: "aws",
      type: "certification",
      status: "accepted",
      evidence: { type: "certification", certId: "aws-cloud-practitioner", issuer: "Amazon Web Services", url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/B2C" },
      certId: "aws-cloud-practitioner",
      issuedOn: "2025-03-01",
      credentialKey: `${p.key}-2`,
      nameMatched: true,
      verifiedAt: new Date(),
    });
    for (const statement of scoped([p.userId])) await db!.execute(sql.raw(statement));
    expect((await proof(p.proofId)).status).toBe("pending");
    await reopenUnconfirmedGoals(db! as never, noGroups, [p.userId]);
    expect(await goalStatus(p.goalId)).toBe("met");
  });

  it("leaves a refused certificate alone when only an unrelated goal is met", async () => {
    const p = await before("unrelated", { url: `https://www.credly.com/badges/${badge("b206")}`, badgeId: badge("b206"), checkNote: "earner_name" });
    for (const statement of scoped([p.userId])) await db!.execute(sql.raw(statement));
    expect(await reopenUnconfirmedGoals(db! as never, noGroups, [p.userId])).toBe(1);
    // The AWS goal is open now; a met goal for another skill doesn't bring the refused AWS badge back.
    await db!.insert(schema.userGoals).values({ userId: p.userId, skillId: "sql", position: 2, status: "met", metAt: new Date() });
    expect(await reopenUnconfirmedGoals(db! as never, noGroups, [p.userId])).toBe(0);
    // A group goal that has AWS still counts.
    const groups = new Map([["cloud-any", ["aws", "azure"]]]);
    await db!.insert(schema.userGoals).values({ userId: p.userId, skillId: "azure", groupId: "cloud-any", position: 3, status: "met", metAt: new Date() });
    expect(await reopenUnconfirmedGoals(db! as never, groups, [p.userId])).toBe(1);
  });
});
