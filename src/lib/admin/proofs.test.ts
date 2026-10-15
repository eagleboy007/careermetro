import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { skills } from "@/content";
import type { CredlyFetcher } from "@/lib/proofs/credly";

const log = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { submitCertificate, notConfirmedSkills } = await import("@/lib/goals/store");
const { heldProofsForReview, reviewHeldProof, PROOF_REVIEW_TEXT } = await import("./proofs");
const { exportAccountData, EXPORT_VERSION } = await import("@/lib/account/export");
const { checkCertificateWithCredly } = await import("@/lib/proofs/credly-store");
const { credlyFixtureFetcher } = await import("@/lib/proofs/credly-fixtures");

// The held-proof review (/admin/proofs, FR-44) against a real Postgres with migrations applied. Every fixture is made
// here, so it runs on an unseeded database.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key", IP_HASH_KEY: "test-ip-key" };
const TODAY = "2026-10-13";
const noGroups = new Map<string, string[]>();
const CERT = "aws-cloud-practitioner";
let next = 0;
const badgeId = () => `c4ed1100-0000-4000-8000-${(0xb00000000000 + Date.now() * 10 + next++).toString(16).slice(-12)}`;

describe.skipIf(!db)("held-proof review (database)", () => {
  const run = `hpr-${Date.now()}`;
  const userIds: string[] = [];
  const adminId = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
  const admin2 = "1c9f9b63-7b2f-4c8f-8e7b-3f2e4d5c6b7a";

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  beforeEach(() => log.mockClear());
  afterAll(async () => {
    await db!.delete(schema.auditLogs).where(inArray(schema.auditLogs.actor, [`admin:${adminId}`, `admin:${admin2}`]));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.certificateCredentials).where(like(schema.certificateCredentials.credentialKey, `${run}%`));
    await sqlClient!.end();
  });

  async function person(n: string, firstName = "Priya", lastName = "Sharma", deleted = false) {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test`, firstName, lastName, name: `${firstName} ${lastName}`, deletionRequestedAt: deleted ? new Date() : null })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    const [goal] = await db!.insert(schema.userGoals).values({ userId: u.id, skillId: "aws", position: 1 }).returning({ id: schema.userGoals.id });
    return { userId: u.id, goalId: goal.id };
  }
  /** A certificate row as the proof code leaves it: accepted, or held with a reason. */
  async function proof(
    userId: string,
    o: { key: string | null; badge?: string | null; status?: "accepted" | "pending"; heldReason?: string | null; checkNote?: "used_elsewhere" | null; verifier?: "credly" | null },
  ) {
    const [row] = await db!
      .insert(schema.gapProofs)
      .values({
        userId,
        skillId: "aws",
        type: "certification",
        status: o.status ?? "pending",
        evidence: { type: "certification", certId: CERT, issuer: "Amazon Web Services", url: o.badge ? `https://www.credly.com/badges/${o.badge}` : "https://www.credly.com/badges/x" },
        certId: CERT,
        credentialKey: o.key === null ? null : `${run}-${o.key}`,
        badgeId: o.badge ?? null,
        heldReason: o.status === "accepted" ? null : (o.heldReason ?? "badge_reused"),
        checkNote: o.checkNote ?? null,
        verifier: o.verifier ?? null,
        verifiedAt: o.status === "accepted" ? new Date() : null,
        nameMatched: true,
      })
      .returning({ id: schema.gapProofs.id });
    return row.id;
  }
  const submit = (who: { userId: string; goalId: string }, credentialId: string) =>
    submitCertificate(
      who.userId,
      { goalId: who.goalId, certId: CERT, credentialId, issuedOn: "2025-03-01", expiresOn: "2028-03-01", nameOnCertificate: "Priya Sharma", url: "https://cp.certmetrics.com/amazon/en/public/verify/credential/EXAMPLE1", confirmed: true },
      { today: TODAY, env, db: db!, members: noGroups },
    );
  const row = async (id: string) => (await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.id, id)))[0]!;
  const proofsOf = (userId: string) => db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, userId));
  const goalStatus = async (goalId: string) => (await db!.select({ status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.id, goalId)))[0]!.status;
  const review = (proofId: string, decision: string, who = adminId) => reviewHeldProof(who, { proofId, decision }, { db: db!, members: noGroups });
  const listed = () => heldProofsForReview({ db: db! });
  const audit = (id: string) =>
    db!.select({ actor: schema.auditLogs.actor, action: schema.auditLogs.action }).from(schema.auditLogs).where(eq(schema.auditLogs.target, `gap_proof:${id}`));
  const logged = () => JSON.stringify(log.mock.calls);

  it("lists held claims with the certificate, plain reason, date, short name and the other holders, never an email", async () => {
    const owner = await person("list-owner", "Meera", "Iyer");
    const badge = badgeId();
    await proof(owner.userId, { key: "list-a", badge, status: "accepted", verifier: "credly" });
    const claimant = await person("list-claim", "Priya", "Sharma");
    const held = await proof(claimant.userId, { key: "list-b", badge, checkNote: "used_elsewhere" });
    // A second row of the same claim (another skill) is one line, and a deleted account's claim isn't listed or counted.
    const [copy] = await db!
      .insert(schema.gapProofs)
      .values({ ...(await row(held)), id: undefined, skillId: "docker" })
      .returning({ id: schema.gapProofs.id });
    const gone = await person("list-gone", "Ravi", "Kumar", true);
    await proof(gone.userId, { key: "list-c", badge, checkNote: "used_elsewhere" });

    const list = await listed();
    // Either row of the claim stands for it; a review settles both.
    const line = list.find((p) => p.id === held || p.id === copy!.id);
    expect(line).toEqual({
      id: expect.any(String),
      certificate: "AWS Certified Cloud Practitioner",
      issuer: "Amazon Web Services",
      reason: "badge_reused",
      reasonText: "Its Credly badge is already verified on another account",
      submittedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      person: "Priya S.",
      others: 1,
      badgeUrl: `https://www.credly.com/badges/${badge}`,
    });
    expect(list.filter((p) => p.person === "Priya S." && p.badgeUrl === line!.badgeUrl)).toHaveLength(1);
    expect(list.some((p) => p.person === "Ravi K.")).toBe(false);
    const text = JSON.stringify(list);
    expect(text).not.toContain("@");
    expect(text).not.toContain(run);
    expect(text).not.toContain("Sharma");

    // Accepting the line settles every row of the claim, one per skill.
    expect((await review(line!.id, "accept")).ok).toBe(true);
    expect((await row(held)).status).toBe("accepted");
    expect((await row(copy!.id)).status).toBe("accepted");
  });

  it("accepts a reused credential for the claimant: their goal fills, the credential is theirs, the first holder's is rejected", async () => {
    const a = await person("cred-a");
    const b = await person("cred-b");
    const credential = `CRED-${run}`;
    expect((await submit(a, credential)).status).toBe("filled");
    expect(await submit(b, credential)).toMatchObject({ status: "held" });
    expect(await goalStatus(a.goalId)).toBe("met");
    expect(await goalStatus(b.goalId)).toBe("active");
    const [heldRow] = await proofsOf(b.userId);
    expect(heldRow).toMatchObject({ status: "pending", heldReason: "credential_reused" });
    expect((await listed()).find((p) => p.id === heldRow!.id)).toMatchObject({ reason: "credential_reused", others: 1, person: "Priya S." });

    expect(await review(heldRow!.id, "accept")).toEqual({ ok: true, message: "Accepted for Priya S. The claim on 1 other account was rejected." });
    expect(await row(heldRow!.id)).toMatchObject({ status: "accepted", heldReason: null, verifier: null });
    expect(await goalStatus(b.goalId)).toBe("met");
    const [aRow] = await proofsOf(a.userId);
    expect(aRow).toMatchObject({ status: "rejected", heldReason: "claimed_elsewhere", verifier: null });
    expect(await goalStatus(a.goalId)).toBe("active");
    const [owner] = await db!
      .select({ userId: schema.certificateCredentials.userId })
      .from(schema.certificateCredentials)
      .where(and(eq(schema.certificateCredentials.certId, CERT), eq(schema.certificateCredentials.credentialKey, heldRow!.credentialKey!)));
    expect(owner!.userId).toBe(b.userId);
    // A's goal says the certificate couldn't be confirmed; B's doesn't.
    expect([...(await notConfirmedSkills(a.userId, db!))]).toEqual(["aws"]);
    expect((await notConfirmedSkills(b.userId, db!)).size).toBe(0);
    // A's download shows the rejection and why.
    const data = await exportAccountData(a.userId, db! as never);
    expect(EXPORT_VERSION).toBe(15);
    expect(data!.proofs[0]).toMatchObject({ status: "rejected", heldReason: "claimed_elsewhere" });
    expect(await audit(heldRow!.id)).toEqual([{ actor: `admin:${adminId}`, action: "proof_accepted" }]);
    expect(await audit(aRow!.id)).toEqual([{ actor: `admin:${adminId}`, action: "proof_rejected_claimed_elsewhere" }]);
    // Logs carry the outcome and counts only.
    expect(log).toHaveBeenCalledWith("info", "proof_reviewed", { decision: "accept", rows: 1, competing: 1 });
    expect(logged()).not.toMatch(/Priya|Sharma|@/);
    expect((await listed()).some((p) => p.id === heldRow!.id)).toBe(false);
    // Already settled: a second press changes nothing.
    expect(await review(heldRow!.id, "accept")).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.not_found });
  });

  it("rejects a held claim: it stays out of the goal, keeps its reason, and the holder is untouched", async () => {
    const a = await person("rej-a");
    const b = await person("rej-b", "Asha", "Rao");
    const badge = badgeId();
    const kept = await proof(a.userId, { key: "rej-a", badge, status: "accepted", verifier: "credly" });
    const held = await proof(b.userId, { key: "rej-b", badge, checkNote: "used_elsewhere" });
    expect(await review(held, "reject")).toEqual({ ok: true, message: "Rejected for Asha R. Their goal says the certificate couldn't be confirmed." });
    expect(await row(held)).toMatchObject({ status: "rejected", heldReason: "badge_reused", verifier: null });
    expect((await row(held)).verifiedAt).not.toBeNull();
    expect(await row(kept)).toMatchObject({ status: "accepted", verifier: "credly" });
    expect(await goalStatus(b.goalId)).toBe("active");
    expect([...(await notConfirmedSkills(b.userId, db!))]).toEqual(["aws"]);
    expect(await audit(held)).toEqual([{ actor: `admin:${adminId}`, action: "proof_rejected" }]);
    expect(log).toHaveBeenCalledWith("info", "proof_reviewed", { decision: "reject", rows: 1, competing: 0 });
    expect(logged()).not.toMatch(/Asha|Rao/);
  });

  it("accepting one badge claim rejects every competing claim on that badge, accepted or waiting, so one account holds it", async () => {
    const a = await person("multi-a");
    const b = await person("multi-b");
    const c = await person("multi-c");
    const badge = badgeId();
    const aId = await proof(a.userId, { key: "multi-a", badge, status: "accepted", verifier: "credly" });
    const bId = await proof(b.userId, { key: "multi-b", badge, checkNote: "used_elsewhere" });
    const cId = await proof(c.userId, { key: "multi-c", badge, checkNote: "used_elsewhere" });
    expect((await listed()).find((p) => p.id === cId)?.others).toBe(2);

    await db!.update(schema.gapProofs).set({ checkedAt: new Date() }).where(eq(schema.gapProofs.id, cId));
    expect(await review(cId, "accept")).toEqual({ ok: true, message: "Accepted for Priya S. The claims on 2 other accounts were rejected." });
    // Accepted as "Added by you": the old check is cleared, and only a fresh Credly check verifies it.
    expect(await row(cId)).toMatchObject({ status: "accepted", verifier: null, checkNote: null, checkedAt: null, heldReason: null });
    expect(await goalStatus(c.goalId)).toBe("met");
    expect(await row(aId)).toMatchObject({ status: "rejected", verifier: null, heldReason: "claimed_elsewhere" });
    expect(await row(bId)).toMatchObject({ status: "rejected", heldReason: "badge_reused" });
    const holders = await db!.select({ userId: schema.gapProofs.userId }).from(schema.gapProofs).where(and(eq(schema.gapProofs.badgeId, badge), eq(schema.gapProofs.status, "accepted")));
    expect(holders).toEqual([{ userId: c.userId }]);
    expect((await listed()).some((p) => p.id === bId)).toBe(false);

    // Check with Credly then verifies it the normal way, with nobody else holding the badge, and applies Credly's expiry.
    const fetcher: CredlyFetcher = async (id) => {
      const f = await credlyFixtureFetcher("c4ed1100-0000-4000-8000-000000000001");
      return f.kind === "ok" ? { kind: "ok", body: { data: { ...(f.body as { data: object }).data, id } } } : f;
    };
    expect(await checkCertificateWithCredly(c.userId, cId, { fetcher, db: db!, env, today: TODAY })).toEqual({ status: "verified" });
    expect(await row(cId)).toMatchObject({ status: "accepted", verifier: "credly", checkNote: null, expiresOn: "2028-03-01" });
  });

  it("leaves out rows waiting for something other than review, such as a Credly check", async () => {
    const a = await person("other-wait");
    const waiting = await proof(a.userId, { key: "other-wait", badge: badgeId(), heldReason: "credly_check" });
    expect((await listed()).some((p) => p.id === waiting)).toBe(false);
    expect(await review(waiting, "accept")).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.not_found });
    expect(await row(waiting)).toMatchObject({ status: "pending", heldReason: "credly_check" });
  });

  it("reviews a held row with no credential hash as a claim of its own, competing by its badge only", async () => {
    const a = await person("nokey-a");
    const b = await person("nokey-b", "Kiran", "Menon");
    const badge = badgeId();
    const kept = await proof(a.userId, { key: "nokey-a", badge, status: "accepted", verifier: "credly" });
    const held = await proof(b.userId, { key: null, badge, checkNote: "used_elsewhere" });
    // A second keyless held row of the same person and certificate is a line of its own.
    const other = await proof(b.userId, { key: null, badge: badgeId(), checkNote: "used_elsewhere" });
    const list = await listed();
    expect(list.find((p) => p.id === held)).toMatchObject({ person: "Kiran M.", others: 1, reason: "badge_reused" });
    expect(list.find((p) => p.id === other)).toMatchObject({ person: "Kiran M.", others: 0 });

    expect(await review(held, "accept")).toEqual({ ok: true, message: "Accepted for Kiran M. The claim on 1 other account was rejected." });
    expect(await row(held)).toMatchObject({ status: "accepted", heldReason: null, verifier: null });
    expect(await row(kept)).toMatchObject({ status: "rejected", heldReason: "claimed_elsewhere" });
    // Only the reviewed row moved: the other keyless claim still waits, and no credential owner was written.
    expect(await row(other)).toMatchObject({ status: "pending" });
    expect(await goalStatus(b.goalId)).toBe("met");
    expect(await review(other, "reject")).toMatchObject({ ok: true });
    expect(await row(other)).toMatchObject({ status: "rejected" });
    expect(await row(held)).toMatchObject({ status: "accepted" });
  });

  it("two admins accepting different claims on the same badge at once leave exactly one accepted", async () => {
    for (let round = 0; round < 3; round++) {
      const b = await person(`race-b${round}`);
      const c = await person(`race-c${round}`);
      const badge = badgeId();
      const bId = await proof(b.userId, { key: `race-b${round}`, badge, checkNote: "used_elsewhere" });
      const cId = await proof(c.userId, { key: `race-c${round}`, badge, checkNote: "used_elsewhere" });
      const results = await Promise.all([review(bId, "accept", adminId), review(cId, "accept", admin2)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.not_found });
      const rows = await db!.select({ status: schema.gapProofs.status }).from(schema.gapProofs).where(eq(schema.gapProofs.badgeId, badge));
      expect(rows.filter((r) => r.status === "accepted")).toHaveLength(1);
      expect(rows.filter((r) => r.status === "rejected")).toHaveLength(1);
      const met = [await goalStatus(b.goalId), await goalStatus(c.goalId)].filter((s) => s === "met");
      expect(met).toHaveLength(1);
    }
  });

  it("refuses bad input and a proof that isn't held, writing nothing", async () => {
    const a = await person("bad-a");
    const accepted = await proof(a.userId, { key: "bad-a", status: "accepted" });
    const before = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${adminId}`));
    expect(await review("not-an-id", "accept")).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.invalid });
    expect(await review(accepted, "delete")).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.invalid });
    expect(await reviewHeldProof(adminId, { proofId: accepted, decision: "accept", userId: a.userId }, { db: db! })).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.invalid });
    expect(await review(accepted, "reject")).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.not_found });
    expect(await review("6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b", "accept")).toEqual({ ok: false, message: PROOF_REVIEW_TEXT.not_found });
    expect(await row(accepted)).toMatchObject({ status: "accepted" });
    const after = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${adminId}`));
    expect(after.length).toBe(before.length);
  });
});
