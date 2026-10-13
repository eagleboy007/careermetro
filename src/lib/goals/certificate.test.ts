import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import type { CertificateSubmission } from "@/lib/schemas";
import { deleteProof, goalsOf, renewExpiredGoals, submitCertificate } from "./store";

vi.mock("server-only", () => ({}));

// Certificate proof (dev/proof-plan.md) against a real Postgres with migrations applied.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };
const TODAY = "2026-10-12";
const noGroups = new Map<string, string[]>();

describe.skipIf(!db)("certificate proof (database)", () => {
  const run = `cert-${Date.now()}`;
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

  /** A person named Priya Sharma (unless named otherwise) with one open goal, for AWS unless another skill is named. */
  async function person(n: string, firstName = "Priya", lastName = "Sharma", skillId = "aws") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, firstName, lastName }).returning({ id: schema.users.id });
    userIds.push(u.id);
    const [goal] = await db!.insert(schema.userGoals).values({ userId: u.id, skillId, position: 1 }).returning({ id: schema.userGoals.id });
    return { userId: u.id, goalId: goal.id };
  }

  const cert = (goalId: string, over: Partial<CertificateSubmission> = {}): CertificateSubmission => ({
    goalId,
    certId: "aws-cloud-practitioner",
    credentialId: "ABC-123-XYZ",
    issuedOn: "2025-03-01",
    expiresOn: "2028-03-01",
    nameOnCertificate: "Priya Sharma",
    url: "https://www.credly.com/badges/example",
    confirmed: true,
    ...over,
  });
  const submit = (userId: string, s: CertificateSubmission, verified = false) => submitCertificate(userId, s, { verified, today: TODAY, env, db: db!, members: noGroups });
  const goalStatus = async (goalId: string) => (await db!.select({ status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.id, goalId)))[0].status;
  const proofsOf = (userId: string) => db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, userId));

  it("fills the goal with a current certificate in the person's name, keeping only a hash of the credential id", async () => {
    const me = await person("fill");
    expect(await submit(me.userId, cert(me.goalId), true)).toMatchObject({ status: "filled", label: "verified", skillId: "aws" });
    expect(await goalStatus(me.goalId)).toBe("met");
    expect((await goalsOf(me.userId, db!, noGroups))[0]).toMatchObject({ status: "met", proved: true });
    const [proof] = await proofsOf(me.userId);
    expect(proof).toMatchObject({ status: "accepted", verifier: "credly", certId: "aws-cloud-practitioner", nameMatched: true, expiresOn: "2028-03-01" });
    expect(JSON.stringify(proof)).not.toContain("ABC-123-XYZ");
    expect(JSON.stringify(proof)).not.toContain("Priya");

    // Sending it again changes nothing.
    expect(await submit(me.userId, cert(me.goalId, { credentialId: "abc123xyz" }))).toMatchObject({ status: "filled", label: "verified", skillId: "aws" });
    expect(await proofsOf(me.userId)).toHaveLength(1);
  });

  it("refuses a certificate in someone else's name, and stores nothing", async () => {
    const me = await person("name");
    expect(await submit(me.userId, cert(me.goalId, { nameOnCertificate: "Amit Verma" }))).toEqual({ status: "refused", reason: "name" });
    expect(await proofsOf(me.userId)).toHaveLength(0);
    expect(await goalStatus(me.goalId)).toBe("active");
  });

  it("holds a credential another account already used, and never fills the second goal", async () => {
    const first = await person("first", "Asha", "Rao");
    const second = await person("second", "Asha", "Rao");
    const shared = { credentialId: `SHARED-${run}`, nameOnCertificate: "Asha Rao" };
    expect((await submit(first.userId, cert(first.goalId, shared))).status).toBe("filled");
    expect(await submit(second.userId, cert(second.goalId, shared))).toEqual({ status: "held", skillId: "aws", reason: "credential" });
    expect(await goalStatus(second.goalId)).toBe("active");
    const [held] = await proofsOf(second.userId);
    expect(held).toMatchObject({ status: "pending", heldReason: "credential_reused" });
    expect(await goalStatus(first.goalId)).toBe("met");
  });

  it("keeps a credential to one account across every skill its certificate proves", async () => {
    // AWS Solutions Architect Associate proves both aws and system-design.
    const first = await person("multi-first", "Asha", "Rao", "aws");
    const second = await person("multi-second", "Asha", "Rao", "system-design");
    const shared = { certId: "aws-solutions-architect-associate", credentialId: `MULTI-${run}`, nameOnCertificate: "Asha Rao" };
    expect((await submit(first.userId, cert(first.goalId, shared))).status).toBe("filled");
    expect(await submit(second.userId, cert(second.goalId, shared))).toEqual({ status: "held", skillId: "system-design", reason: "credential" });
    expect(await goalStatus(second.goalId)).toBe("active");
  });

  it("keeps one held row however often a held certificate is sent again", async () => {
    const first = await person("again-first", "Asha", "Rao");
    const second = await person("again-second", "Asha", "Rao");
    const shared = { credentialId: `AGAIN-${run}`, nameOnCertificate: "Asha Rao" };
    await submit(first.userId, cert(first.goalId, shared));
    expect((await submit(second.userId, cert(second.goalId, shared))).status).toBe("held");
    expect((await submit(second.userId, cert(second.goalId, shared))).status).toBe("held");
    expect(await proofsOf(second.userId)).toHaveLength(1);
  });

  it("frees a credential once its owner deletes their last proof of it", async () => {
    const first = await person("free-first", "Asha", "Rao");
    const second = await person("free-second", "Asha", "Rao");
    const shared = { credentialId: `FREE-${run}`, nameOnCertificate: "Asha Rao" };
    await submit(first.userId, cert(first.goalId, shared));
    const [proof] = await proofsOf(first.userId);
    expect(await deleteProof(first.userId, proof.id, db!, noGroups)).toBe(true);
    expect((await submit(second.userId, cert(second.goalId, shared))).status).toBe("filled");
  });

  it("refuses another person's goal, expired certificates and ones that don't cover the skill", async () => {
    const me = await person("rules");
    const them = await person("rules-other");
    expect(await submit(me.userId, cert(them.goalId))).toEqual({ status: "refused", reason: "not_found" });
    expect(await submit(me.userId, cert(me.goalId, { expiresOn: "2026-10-01" }))).toEqual({ status: "refused", reason: "expired" });
    expect(await submit(me.userId, cert(me.goalId, { certId: "az-900" }))).toMatchObject({ status: "refused" });
    expect(await proofsOf(me.userId)).toHaveLength(0);
  });

  it("turns the goal to renew once the certificate expires, and a current one fills it again", async () => {
    const me = await person("renew");
    await submit(me.userId, cert(me.goalId, { credentialId: `OLD-${run}`, expiresOn: "2026-11-01" }));
    expect(await goalStatus(me.goalId)).toBe("met");
    expect(await renewExpiredGoals("2026-11-02", db!, noGroups)).toBeGreaterThanOrEqual(1);
    expect(await goalStatus(me.goalId)).toBe("renew");
    const renewed = await submitCertificate(me.userId, cert(me.goalId, { credentialId: `NEW-${run}`, issuedOn: "2026-11-02", expiresOn: "2029-11-02" }), {
      today: "2026-11-02",
      env,
      db: db!,
      members: noGroups,
    });
    expect(renewed.status).toBe("filled");
    expect(await goalStatus(me.goalId)).toBe("met");
  });

  it("renews with the same credential id: the new dates fill the goal again", async () => {
    const me = await person("same-id");
    const same = { credentialId: `SAME-${run}` };
    await submit(me.userId, cert(me.goalId, { ...same, expiresOn: "2026-11-01" }));
    await renewExpiredGoals("2026-11-02", db!, noGroups);
    expect(await goalStatus(me.goalId)).toBe("renew");
    const renewed = await submitCertificate(me.userId, cert(me.goalId, { ...same, issuedOn: "2026-11-02", expiresOn: "2027-11-02" }), { today: "2026-11-02", env, db: db!, members: noGroups });
    expect(renewed.status).toBe("filled");
    expect(await goalStatus(me.goalId)).toBe("met");
    const [proof] = await proofsOf(me.userId);
    expect(proof).toMatchObject({ issuedOn: "2026-11-02", expiresOn: "2027-11-02" });
    expect(await proofsOf(me.userId)).toHaveLength(1);
  });

  it("leaves a goal the resume meets as met when its certificate expires", async () => {
    const me = await person("resume-met");
    const [resume] = await db!.insert(schema.resumes).values({ userId: me.userId, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const profile = { headline: null, totalYearsExperience: null, roles: [], skills: [], education: [], certifications: [] };
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
    await db!.insert(schema.gapAnalyses).values({
      profileId: p.id,
      matcherVersion: MATCHER_VERSION,
      result: { roleSlug: roleProfiles[0].slug, gaps: [], metSkillIds: ["aws"], niceToHave: [], readiness: { headline: "h", explanation: "e", estimatedHours: 1 } },
    });
    await submit(me.userId, cert(me.goalId, { credentialId: `RMET-${run}`, expiresOn: "2026-11-01" }));
    expect(await goalStatus(me.goalId)).toBe("met");
    await renewExpiredGoals("2026-11-02", db!, noGroups);
    expect(await goalStatus(me.goalId)).toBe("met");
  });

  it("lets only the owner delete a proof, which opens the goal again", async () => {
    const me = await person("delete");
    const them = await person("delete-other");
    await submit(me.userId, cert(me.goalId, { credentialId: `DEL-${run}` }));
    const [proof] = await proofsOf(me.userId);
    expect(await deleteProof(them.userId, proof.id, db!, noGroups)).toBe(false);
    expect(await goalStatus(me.goalId)).toBe("met");
    expect(await deleteProof(me.userId, proof.id, db!, noGroups)).toBe(true);
    expect(await goalStatus(me.goalId)).toBe("active");
    expect(await db!.select().from(schema.gapProofs).where(and(eq(schema.gapProofs.id, proof.id)))).toHaveLength(0);
  });
});
