import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { skills } from "@/content";
import type { CertificateSubmission } from "@/lib/schemas";
import type { CredlyFetcher } from "./credly";

const log = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { provedSkills, submitCertificate } = await import("@/lib/goals/store");
const { checkCertificateWithCredly, credlyFetcherFor } = await import("./credly-store");
const { credlyFixtureFetcher } = await import("./credly-fixtures");
const { exportAccountData, EXPORT_VERSION } = await import("@/lib/account/export");
const { certificateProofsFor } = await import("@/lib/me/store");
const { LIMITS, takeShared } = await import("@/lib/shared-limit");

// The Credly check (pending item 13, dev/profile-certs-plan.md) against a real Postgres with migrations applied. The
// fetcher is the recorded synthetic fixtures; nothing calls Credly.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key", IP_HASH_KEY: "test-ip-key" };
const TODAY = "2026-10-13";
const noGroups = new Map<string, string[]>();
const badge = (n: string) => `https://www.credly.com/badges/c4ed1100-0000-4000-8000-0000000000${n}`;
/**
 * A badge id of its own for each test that verifies, since one badge is verified on one account only. Credly answers
 * it with Priya's matching badge (fixture 01) under that id; the fixture ids go to the fixtures.
 */
let next = 0;
function ownBadge() {
  const id = `c4ed1100-0000-4000-8000-${(0xa00000000000 + Date.now() * 10 + next++).toString(16).slice(-12)}`;
  return { id, url: `https://www.credly.com/badges/${id}` };
}
const fetcher: CredlyFetcher = async (id) => {
  if (id.startsWith("c4ed1100-0000-4000-8000-0000000000")) return credlyFixtureFetcher(id);
  const f = await credlyFixtureFetcher("c4ed1100-0000-4000-8000-000000000001");
  return f.kind === "ok" ? { kind: "ok", body: { data: { ...(f.body as { data: object }).data, id } } } : f;
};
/** Priya's matching badge under any id, with some of Credly's fields changed. */
const answering =
  (over: Record<string, unknown>): CredlyFetcher =>
  async (id) => {
    const f = await fetcher(id);
    return f.kind === "ok" ? { kind: "ok", body: { data: { ...(f.body as { data: object }).data, ...over } } } : f;
  };
const down: CredlyFetcher = async () => ({ kind: "unreachable" });

describe.skipIf(!db)("Credly check (database)", () => {
  const run = `credly-${Date.now()}`;
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

  async function person(n: string, firstName = "Priya", lastName = "Sharma", skillId = "aws") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, firstName, lastName }).returning({ id: schema.users.id });
    userIds.push(u.id);
    const [goal] = await db!.insert(schema.userGoals).values({ userId: u.id, skillId, position: 1 }).returning({ id: schema.userGoals.id });
    return { userId: u.id, goalId: goal.id };
  }
  const cert = (goalId: string, over: Partial<CertificateSubmission> = {}): CertificateSubmission => ({
    goalId,
    certId: "aws-cloud-practitioner",
    credentialId: `CRED-${goalId.slice(0, 8)}`,
    issuedOn: "2025-03-01",
    expiresOn: "2028-03-01",
    nameOnCertificate: "Priya Sharma",
    url: ownBadge().url,
    confirmed: true,
    ...over,
  });
  const submit = (userId: string, s: CertificateSubmission) => submitCertificate(userId, s, { today: TODAY, env, db: db!, members: noGroups });
  /** Adds a Credly certificate, which waits for its check, and returns its proof id. */
  async function added(userId: string, goalId: string, over: Partial<CertificateSubmission> = {}) {
    const out = await submit(userId, cert(goalId, over));
    if (out.status !== "pending") throw new Error(`not pending: ${JSON.stringify(out)}`);
    return out.proofId;
  }
  /** Adds a Credly certificate and has Credly confirm it. */
  async function verified(userId: string, goalId: string, over: Partial<CertificateSubmission> = {}) {
    const id = await added(userId, goalId, over);
    expect(await check(userId, id)).toEqual({ status: "verified" });
    return id;
  }
  const check = (userId: string, proofId: string, f = fetcher) => checkCertificateWithCredly(userId, proofId, { fetcher: f, db: db!, env, today: TODAY });
  const proof = async (id: string) => (await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.id, id)))[0];
  const goalStatus = async (goalId: string) => (await db!.select({ status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.id, goalId)))[0].status;
  /** What companies and the goals read as Met: current accepted proof only. */
  const met = async (userId: string) => (await provedSkills(userId, db! as never, TODAY)).includes("aws");

  it("keeps a Credly badge pending until Credly confirms it, then verifies it and fills the goal", async () => {
    const me = await person("match");
    const id = await added(me.userId, me.goalId);
    expect(await proof(id)).toMatchObject({ status: "pending", heldReason: "credly_check", verifier: null, checkedAt: null, checkNote: null });
    expect(await goalStatus(me.goalId)).toBe("active");
    expect(await met(me.userId)).toBe(false);
    const before = Date.now();
    expect(await check(me.userId, id)).toEqual({ status: "verified" });
    const p = await proof(id);
    expect(p).toMatchObject({ status: "accepted", heldReason: null, verifier: "credly", checkNote: null });
    expect(p.verifiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(p.checkedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await goalStatus(me.goalId)).toBe("met");
    expect(await met(me.userId)).toBe(true);
  });

  it("checks every row of the credential, one per skill the certificate proves", async () => {
    const me = await person("multi", "Priya", "Sharma", "aws");
    const [g2] = await db!.insert(schema.userGoals).values({ userId: me.userId, skillId: "system-design", position: 2 }).returning({ id: schema.userGoals.id });
    // A Solutions Architect badge would be needed for a real match; here the mismatch reason must reach both rows.
    const shared = { certId: "aws-solutions-architect-associate", credentialId: `SAA-${run}`, url: ownBadge().url };
    const a = await added(me.userId, me.goalId, shared);
    const b = await added(me.userId, g2.id, shared);
    expect(await check(me.userId, a)).toEqual({ status: "pending", note: "badge_name" });
    expect(await proof(a)).toMatchObject({ status: "pending", checkNote: "badge_name" });
    expect(await proof(b)).toMatchObject({ status: "pending", checkNote: "badge_name" });
  });

  it("leaves a badge Credly doesn't confirm as check pending, with the reason, filling nothing", async () => {
    for (const [n, note] of [
      ["03", "badge_name"],
      ["04", "not_public"],
      ["05", "issuer"],
      ["ff", "not_found"],
    ] as const) {
      const other = await person(`mismatch-${n}`);
      const pid = await added(other.userId, other.goalId, { url: badge(n) });
      expect(await check(other.userId, pid), n).toEqual({ status: "pending", note });
      expect(await proof(pid), n).toMatchObject({ status: "pending", heldReason: "credly_check", verifier: null, checkNote: note });
      expect(await goalStatus(other.goalId), n).toBe("active");
    }
  });

  it("keeps a verification when Credly can't be reached, and keeps a new badge pending", async () => {
    const me = await person("unreachable");
    const id = await verified(me.userId, me.goalId);
    expect(await check(me.userId, id, down)).toEqual({ status: "verified" });
    expect(await proof(id)).toMatchObject({ verifier: "credly", checkNote: null });
    expect(await goalStatus(me.goalId)).toBe("met");

    const them = await person("unreachable-new");
    const theirs = await added(them.userId, them.goalId, { url: badge("f0") });
    expect(await check(them.userId, theirs)).toEqual({ status: "pending", note: "unreachable" });
    expect(await proof(theirs)).toMatchObject({ status: "pending", heldReason: "credly_check", verifier: null, checkNote: "unreachable" });
    expect(await goalStatus(them.goalId)).toBe("active");
  });

  it("stops a verified badge filling the goal when Credly says it was taken back", async () => {
    const me = await person("revoked");
    const id = await verified(me.userId, me.goalId);
    const revoked = async (badgeId: string) => ({ kind: "ok" as const, body: { data: { id: badgeId, state: "revoked", badge_template: { name: "x" } } } });
    expect(await check(me.userId, id, revoked)).toEqual({ status: "pending", note: "not_public" });
    expect(await proof(id)).toMatchObject({ status: "pending", verifier: null, checkNote: "not_public" });
    expect(await goalStatus(me.goalId)).toBe("active");
  });

  // T48, Testing's steps (run 3): account B adds account A's Credly badge link as their own proof, typing B's own name.
  describe("T48: someone else's Credly badge", () => {
    it("holds A's badge on B's account at submission, before any Credly call, and it never fills B's goal", async () => {
      const a = await person("t48-a");
      const b = await person("t48-b", "Amit", "Verma");
      const { url } = ownBadge();
      await verified(a.userId, a.goalId, { credentialId: `T48A-${run}`, url });
      const calls = vi.fn(fetcher);
      const out = await submit(b.userId, cert(b.goalId, { credentialId: `T48B-${run}`, nameOnCertificate: "Amit Verma", url }));
      expect(out).toEqual({ status: "held", skillId: "aws", reason: "badge" });
      const [row] = await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, b.userId));
      expect(row).toMatchObject({ status: "pending", heldReason: "badge_reused", checkNote: "used_elsewhere", verifier: null });
      // Check with Credly keeps it held without calling Credly.
      expect(await check(b.userId, row.id, calls)).toEqual({ status: "held" });
      expect(calls).not.toHaveBeenCalled();
      expect(await goalStatus(b.goalId)).toBe("active");
      expect(await met(b.userId)).toBe(false);
      expect(await certificateProofsFor(b.userId, db! as never)).toEqual([]);
    });

    it("holds it at submission even when A's badge was accepted without Credly's word yet", async () => {
      const a = await person("t48-acc-a");
      const b = await person("t48-acc-b", "Amit", "Verma");
      const { url } = ownBadge();
      // An older accepted certificate on A's account, from before Credly links waited for a check.
      const id = await added(a.userId, a.goalId, { credentialId: `T48C-${run}`, url });
      await db!.update(schema.gapProofs).set({ status: "accepted", heldReason: null }).where(eq(schema.gapProofs.id, id));
      expect(await submit(b.userId, cert(b.goalId, { credentialId: `T48D-${run}`, nameOnCertificate: "Amit Verma", url }))).toMatchObject({ status: "held", reason: "badge" });
    });

    it("refuses a badge Credly shows in another person's name, like a typed name mismatch, and frees the credential", async () => {
      // B is Priya on CareerMetro; the badge's earner on Credly is Amit Verma (fixture 07), not on CareerMetro.
      const b = await person("t48-name");
      const id = await added(b.userId, b.goalId, { url: badge("07"), credentialId: `T48E-${run}` });
      expect(await check(b.userId, id)).toEqual({ status: "rejected", reason: "name" });
      expect(await proof(id)).toMatchObject({ status: "rejected", verifier: null, checkNote: "earner_name" });
      expect(await goalStatus(b.goalId)).toBe("active");
      expect(await met(b.userId)).toBe(false);
      expect(await certificateProofsFor(b.userId, db! as never)).toEqual([]);
      const owners = await db!.select().from(schema.certificateCredentials).where(eq(schema.certificateCredentials.userId, b.userId));
      expect(owners).toHaveLength(0);
    });

    it("takes back an accepted badge once Credly shows another earner's name", async () => {
      const b = await person("t48-later");
      const id = await verified(b.userId, b.goalId);
      expect(await goalStatus(b.goalId)).toBe("met");
      const someoneElse = answering({ issued_to: "Amit Verma", issued_to_first_name: "Amit", issued_to_last_name: "Verma" });
      expect(await check(b.userId, id, someoneElse)).toEqual({ status: "rejected", reason: "name" });
      expect(await proof(id)).toMatchObject({ status: "rejected", verifier: null });
      expect(await goalStatus(b.goalId)).toBe("active");
      expect(await met(b.userId)).toBe(false);
    });

    it("keeps it pending, filling nothing, when the daily check limit is used up or Credly is down", async () => {
      const b = await person("t48-limit", "Amit", "Verma");
      for (let i = 0; i < LIMITS.credlyChecksPerUser.max; i++) await takeShared(LIMITS.credlyChecksPerUser, b.userId, { db: db! as never });
      const calls = vi.fn(fetcher);
      const id = await added(b.userId, b.goalId, { url: badge("01"), nameOnCertificate: "Amit Verma", credentialId: `T48F-${run}` });
      expect(await check(b.userId, id, calls)).toEqual({ status: "refused", reason: "too_many" });
      expect(calls).not.toHaveBeenCalled();
      expect(await proof(id)).toMatchObject({ status: "pending", heldReason: "credly_check" });
      expect(await goalStatus(b.goalId)).toBe("active");
      expect(await met(b.userId)).toBe(false);
      // The owner sees it as check pending; it isn't accepted.
      expect(await certificateProofsFor(b.userId, db! as never)).toMatchObject([{ proofId: id, pending: true }]);

      const c = await person("t48-down", "Amit", "Verma");
      const cid = await added(c.userId, c.goalId, { url: badge("01"), nameOnCertificate: "Amit Verma", credentialId: `T48G-${run}` });
      expect(await check(c.userId, cid, down)).toEqual({ status: "pending", note: "unreachable" });
      expect(await met(c.userId)).toBe(false);
    });

    it("still applies one badge per account when Credly can't be checked", async () => {
      const a = await person("t48-off-a");
      const b = await person("t48-off-b");
      const { url } = ownBadge();
      await verified(a.userId, a.goalId, { credentialId: `T48H-${run}`, url });
      const id = await added(b.userId, b.goalId, { credentialId: `T48I-${run}`, url: ownBadge().url });
      // B's proof is moved to A's badge link behind the form's back; the check holds it without the network.
      await db!.update(schema.gapProofs).set({ evidence: { type: "certification", certId: "aws-cloud-practitioner", issuer: "x", url } }).where(eq(schema.gapProofs.id, id));
      expect(await check(b.userId, id, down)).toEqual({ status: "held" });
      expect(await proof(id)).toMatchObject({ status: "pending", heldReason: "badge_reused" });
    });
  });

  // T49: Credly's expiry date counts on every definite answer, and an expired badge leads to Renew.
  describe("T49: Credly's expiry date", () => {
    it("takes Credly's date when Credly shows the badge as expired, so the goal reads Renew", async () => {
      const me = await person("t49-expired");
      const id = await added(me.userId, me.goalId, { url: badge("06"), expiresOn: "2028-03-01" });
      expect(await check(me.userId, id)).toEqual({ status: "added", note: "expired" });
      expect(await proof(id)).toMatchObject({ status: "accepted", expiresOn: "2026-01-01", checkNote: "expired", verifier: null });
      expect(await goalStatus(me.goalId)).toBe("renew");
      expect(await met(me.userId)).toBe(false);
    });

    it("turns a verified certificate to Renew when Credly later shows it expired", async () => {
      const me = await person("t49-later");
      // AWS certificates expire, so the form asks for the printed date (T156); Credly's earlier one wins.
      const id = await verified(me.userId, me.goalId, { expiresOn: "2028-03-01" });
      expect(await goalStatus(me.goalId)).toBe("met");
      expect(await check(me.userId, id, answering({ expires_at_date: "2026-06-30" }))).toEqual({ status: "added", note: "expired" });
      expect(await proof(id)).toMatchObject({ expiresOn: "2026-06-30" });
      expect(await goalStatus(me.goalId)).toBe("renew");
    });

    it("takes Credly's earlier date on other definite answers too", async () => {
      const me = await person("t49-other");
      const id = await added(me.userId, me.goalId, { expiresOn: "2028-03-01" });
      const other = answering({ expires_at_date: "2027-01-01", badge_template: { name: "Something else" } });
      expect(await check(me.userId, id, other)).toEqual({ status: "pending", note: "badge_name" });
      expect((await proof(id)).expiresOn).toBe("2027-01-01");
    });

    it("never lets Verified outlive the badge: the expiry becomes the earlier of the typed date and Credly's", async () => {
      const cases: [string | null, string | null, string | null][] = [
        // typed, Credly's, stored after verifying
        ["2028-03-01", "2027-01-01", "2027-01-01"],
        [null, "2027-01-01", "2027-01-01"],
        ["2026-12-01", "2027-01-01", "2026-12-01"],
        ["2028-03-01", null, "2028-03-01"],
        [null, null, null],
      ];
      for (const [i, [typed, theirs, stored]] of cases.entries()) {
        const me = await person(`expiry-${i}`);
        const id = await added(me.userId, me.goalId, { expiresOn: typed });
        expect(await check(me.userId, id, answering({ expires_at_date: theirs })), String(i)).toEqual({ status: "verified" });
        expect((await proof(id)).expiresOn, String(i)).toBe(stored);
        expect(await goalStatus(me.goalId)).toBe("met");
      }
    });
  });

  // T50: a badge held because another account has it can be released.
  describe("T50: releasing a badge held for another account", () => {
    async function heldPair(n: string) {
      const a = await person(`t50-${n}-a`);
      const b = await person(`t50-${n}-b`);
      const { url } = ownBadge();
      const aProof = await verified(a.userId, a.goalId, { credentialId: `T50A-${n}-${run}`, url });
      const out = await submit(b.userId, cert(b.goalId, { credentialId: `T50B-${n}-${run}`, url }));
      expect(out).toMatchObject({ status: "held", reason: "badge" });
      const [row] = await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, b.userId));
      return { a, b, aProof, bProof: row.id };
    }

    it("keeps it held while the other account still has the badge", async () => {
      const { b, bProof } = await heldPair("still");
      expect(await check(b.userId, bProof)).toEqual({ status: "held" });
      expect(await goalStatus(b.goalId)).toBe("active");
    });

    it("releases it on a check once the other account asked to be deleted, and verifies it", async () => {
      const { a, b, bProof } = await heldPair("deleting");
      await db!.update(schema.users).set({ deletionRequestedAt: new Date() }).where(eq(schema.users.id, a.userId));
      expect(await check(b.userId, bProof)).toEqual({ status: "verified" });
      expect(await proof(bProof)).toMatchObject({ status: "accepted", heldReason: null, verifier: "credly" });
      expect(await goalStatus(b.goalId)).toBe("met");
    });

    it("releases it once the other account is purged", async () => {
      const { a, b, bProof } = await heldPair("purged");
      await db!.delete(schema.users).where(eq(schema.users.id, a.userId));
      expect(await check(b.userId, bProof)).toEqual({ status: "verified" });
    });

    it("releases it once the other account removed the badge, and keeps it pending if Credly is down", async () => {
      const { a, b, aProof, bProof } = await heldPair("removed");
      await db!.delete(schema.gapProofs).where(eq(schema.gapProofs.id, aProof));
      expect(a.userId).toBeTruthy();
      expect(await check(b.userId, bProof, down)).toEqual({ status: "pending", note: "unreachable" });
      expect(await proof(bProof)).toMatchObject({ status: "pending", heldReason: "credly_check" });
      expect(await check(b.userId, bProof)).toEqual({ status: "verified" });
    });

    it("doesn't hold a new badge for an account waiting to be deleted", async () => {
      const a = await person("t50-new-a");
      const b = await person("t50-new-b");
      const { url } = ownBadge();
      await verified(a.userId, a.goalId, { credentialId: `T50C-${run}`, url });
      await db!.update(schema.users).set({ deletionRequestedAt: new Date() }).where(eq(schema.users.id, a.userId));
      expect(await submit(b.userId, cert(b.goalId, { credentialId: `T50D-${run}`, url }))).toMatchObject({ status: "pending" });
    });
  });

  it("refuses the same credential or badge again once a review rejected it, pointing to Grievances", async () => {
    const { b, bProof } = await (async () => {
      const a = await person("reviewed-a");
      const b = await person("reviewed-b");
      const { url } = ownBadge();
      await verified(a.userId, a.goalId, { credentialId: `RV-A-${run}`, url });
      expect(await submit(b.userId, cert(b.goalId, { credentialId: `RV-B-${run}`, url }))).toMatchObject({ status: "held", reason: "badge" });
      const [row] = await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, b.userId));
      return { b, bProof: row.id, url };
    })();
    // What the held-proof review writes on Reject: rejected, with the held reason kept.
    await db!.update(schema.gapProofs).set({ status: "rejected" }).where(eq(schema.gapProofs.id, bProof));
    const row = await proof(bProof);
    const badgeUrl = (row.evidence as { url: string }).url;
    // The same credential id, and the same badge under another credential id, are both refused.
    expect(await submit(b.userId, cert(b.goalId, { credentialId: `RV-B-${run}`, url: badgeUrl }))).toEqual({ status: "refused", reason: "reviewed" });
    expect(await submit(b.userId, cert(b.goalId, { credentialId: `RV-C-${run}`, url: badgeUrl }))).toEqual({ status: "refused", reason: "reviewed" });
    expect(await submit(b.userId, cert(b.goalId, { credentialId: `RV-B-${run}`, url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/RV" }))).toEqual({
      status: "refused",
      reason: "reviewed",
    });
    expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, b.userId))).toHaveLength(1);
    const { CERTIFICATE_REFUSAL_MESSAGES } = await import("./messages");
    expect(CERTIFICATE_REFUSAL_MESSAGES.reviewed).toMatch(/Grievances/);
    // A different certificate is still welcome.
    expect(await submit(b.userId, cert(b.goalId, { credentialId: `RV-D-${run}` }))).toMatchObject({ status: "pending" });
  });

  it("never takes a refused row as the person's existing certificate, so sending it again keeps one accepted row", async () => {
    const me = await person("refused-row");
    const credentialId = `RR-${run}`;
    const ms = "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/RR";
    const old = await submit(me.userId, cert(me.goalId, { url: ms, credentialId }));
    if (old.status !== "filled") throw new Error(JSON.stringify(old));
    // Refused some other way than a review or Credly's name check (setProofStatus).
    await db!.update(schema.gapProofs).set({ status: "rejected", verifier: null }).where(eq(schema.gapProofs.id, old.proofId));
    const first = await submit(me.userId, cert(me.goalId, { url: ms, credentialId }));
    expect(first).toMatchObject({ status: "filled", label: "added" });
    expect((first as { proofId: string }).proofId).not.toBe(old.proofId);
    for (let i = 0; i < 3; i++) expect(await submit(me.userId, cert(me.goalId, { url: ms, credentialId, issuedOn: `2025-0${i + 4}-01` }))).toEqual(first);
    const rows = await db!.select({ status: schema.gapProofs.status }).from(schema.gapProofs).where(eq(schema.gapProofs.userId, me.userId));
    expect(rows.map((r) => r.status).sort()).toEqual(["accepted", "rejected"]);
  });

  // Review B1: a Credly link that names no badge would skip the check and fill the goal at once.
  describe("B1: Credly links must name a badge", () => {
    it("refuses the victim's badge link with .json added, saving nothing", async () => {
      const a = await person("b1-victim");
      const b = await person("b1-copier", "Amit", "Verma");
      const { url } = ownBadge();
      await verified(a.userId, a.goalId, { credentialId: `B1A-${run}`, url });
      expect(await submit(b.userId, cert(b.goalId, { credentialId: `B1B-${run}`, nameOnCertificate: "Amit Verma", url: `${url}.json` }))).toEqual({ status: "refused", reason: "link" });
      expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, b.userId))).toEqual([]);
      expect(await goalStatus(b.goalId)).toBe("active");
    });

    it("refuses the same credential again after Credly named another earner, with any link", async () => {
      const me = await person("b1-renamed");
      const credentialId = `B1C-${run}`;
      const id = await added(me.userId, me.goalId, { url: badge("07"), credentialId });
      expect(await check(me.userId, id)).toEqual({ status: "rejected", reason: "name" });
      expect(await submit(me.userId, cert(me.goalId, { url: `${badge("07")}.json`, credentialId }))).toEqual({ status: "refused", reason: "link" });
      expect(await submit(me.userId, cert(me.goalId, { url: badge("07"), credentialId }))).toEqual({ status: "refused", reason: "name" });
      expect(await submit(me.userId, cert(me.goalId, { url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/B1C", credentialId }))).toEqual({
        status: "refused",
        reason: "name",
      });
      expect(await goalStatus(me.goalId)).toBe("active");
      expect(await met(me.userId)).toBe(false);
    });

    it("never accepts a pending Credly certificate sent again with a link that names no badge", async () => {
      const me = await person("b1-pending");
      const credentialId = `B1D-${run}`;
      const id = await added(me.userId, me.goalId, { credentialId });
      expect(await submit(me.userId, cert(me.goalId, { url: "https://www.credly.com/badges/anything", credentialId }))).toEqual({ status: "refused", reason: "link" });
      expect(await proof(id)).toMatchObject({ status: "pending", heldReason: "credly_check" });
      expect(await goalStatus(me.goalId)).toBe("active");
      expect(await met(me.userId)).toBe(false);
    });
  });

  it("verifies one badge on one account only", async () => {
    const first = await person("badge-first");
    const second = await person("badge-second");
    const { url: one } = ownBadge();
    const a = await added(first.userId, first.goalId, { credentialId: `B1-${run}`, url: one });
    const b = await added(second.userId, second.goalId, { credentialId: `B2-${run}`, url: one });
    expect(await check(first.userId, a)).toEqual({ status: "verified" });
    expect(await check(second.userId, b)).toEqual({ status: "held" });
    expect(await proof(b)).toMatchObject({ status: "pending", heldReason: "badge_reused", verifier: null, checkNote: "used_elsewhere" });
    // Sending it again keeps it held, with one row.
    const again = await submit(second.userId, cert(second.goalId, { credentialId: `B2-${run}`, url: one }));
    expect(again).toEqual({ status: "held", skillId: "aws", reason: "badge" });
    expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, second.userId))).toHaveLength(1);
    expect((await proof(a)).verifier).toBe("credly");
  });

  it("lets only one of two accounts checking the same badge at once verify it", async () => {
    for (let round = 0; round < 3; round++) {
      const one = await person(`race-${round}-a`);
      const two = await person(`race-${round}-b`);
      const { url } = ownBadge();
      const a = await added(one.userId, one.goalId, { credentialId: `RA-${round}-${run}`, url });
      const b = await added(two.userId, two.goalId, { credentialId: `RB-${round}-${run}`, url });
      // A slow Credly reply for both, so both reach the write at about the same moment.
      const slow: CredlyFetcher = async (id) => {
        await new Promise((r) => setTimeout(r, 50));
        return fetcher(id);
      };
      const results = await Promise.all([check(one.userId, a, slow), check(two.userId, b, slow)]);
      expect(results.map((r) => r.status).sort()).toEqual(["held", "verified"]);
      const confirmed = await db!.select().from(schema.gapProofs).where(and(eq(schema.gapProofs.badgeId, (await proof(a)).badgeId!), eq(schema.gapProofs.verifier, "credly")));
      expect(confirmed).toHaveLength(1);
    }
  });

  it("checks only the person's own Credly certificates", async () => {
    const me = await person("own");
    const them = await person("own-other");
    const id = await added(me.userId, me.goalId);
    expect(await check(them.userId, id)).toEqual({ status: "refused", reason: "not_found" });
    expect(await check(me.userId, "not-a-uuid")).toEqual({ status: "refused", reason: "not_found" });
    // Other verify links keep the old rule: accepted at once, Added by you, and not checked with Credly.
    const ms = await person("own-ms");
    const msOut = await submit(ms.userId, cert(ms.goalId, { url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/ABC123" }));
    expect(msOut).toMatchObject({ status: "filled", label: "added" });
    expect(await goalStatus(ms.goalId)).toBe("met");
    expect(await check(ms.userId, (msOut as { proofId: string }).proofId)).toEqual({ status: "refused", reason: "not_credly" });
    // A held proof (a credential another account used) isn't checked either.
    const held = await person("own-held");
    const out = await submit(held.userId, cert(held.goalId, { credentialId: `CRED-${me.goalId.slice(0, 8)}` }));
    expect(out).toMatchObject({ status: "held", reason: "credential" });
    const [heldProof] = await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, held.userId));
    expect(await check(held.userId, heldProof.id)).toEqual({ status: "refused", reason: "not_found" });
  });

  it("counts checks against the daily limit, and calls nothing over it", async () => {
    const me = await person("limit");
    const id = await added(me.userId, me.goalId, { url: badge("03") });
    const fetcher = vi.fn(credlyFixtureFetcher);
    for (let i = 0; i < 10; i++) expect((await check(me.userId, id, fetcher)).status).toBe("pending");
    expect(await check(me.userId, id, fetcher)).toEqual({ status: "refused", reason: "too_many" });
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("clears the check when the same certificate comes back with another link", async () => {
    const me = await person("relink");
    const id = await verified(me.userId, me.goalId);
    const again = await submit(me.userId, cert(me.goalId, { url: badge("03") }));
    expect(again).toMatchObject({ status: "pending", proofId: id });
    expect(await proof(id)).toMatchObject({ status: "pending", verifier: null, checkedAt: null, checkNote: null, badgeId: "c4ed1100-0000-4000-8000-000000000003" });
    expect(await goalStatus(me.goalId)).toBe("active");
    await check(me.userId, id);
    expect((await proof(id)).checkNote).toBe("badge_name");
  });

  it("logs only the outcome: no badge id, link or name", async () => {
    log.mockClear();
    const me = await person("logs");
    await verified(me.userId, me.goalId);
    const b = await person("logs-b");
    const refused = await added(b.userId, b.goalId, { url: badge("07") });
    expect(await check(b.userId, refused)).toEqual({ status: "rejected", reason: "name" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("certificate_check");
    expect(logged).not.toMatch(/c4ed1100|credly\.com|Priya|Sharma|Amit|Verma/);
  });

  it("is in the person's download, and goes with the account", async () => {
    const me = await person("export");
    const id = await verified(me.userId, me.goalId);
    const data = await exportAccountData(me.userId, db! as never);
    expect(EXPORT_VERSION).toBe(38);
    expect(data!.exportVersion).toBe(38);
    expect(data!.proofs[0]).toMatchObject({ verifier: "credly", badgeId: (await proof(id)).badgeId, checkNote: null });
    expect(data!.proofs[0].checkedAt).toBeTruthy();
    await db!.delete(schema.users).where(eq(schema.users.id, me.userId));
    expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, me.userId))).toHaveLength(0);
  });
});

describe("the fetcher", () => {
  it("uses the recorded fixtures only with the local stand-in API, never in production", () => {
    expect(credlyFetcherFor({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4011" })).toBe(credlyFixtureFetcher);
    expect(credlyFetcherFor({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4011", VERCEL_ENV: "production" })).not.toBe(credlyFixtureFetcher);
    expect(credlyFetcherFor({})).not.toBe(credlyFixtureFetcher);
  });
});
