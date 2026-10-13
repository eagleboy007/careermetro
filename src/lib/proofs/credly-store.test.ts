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

const { submitCertificate } = await import("@/lib/goals/store");
const { checkCertificateWithCredly, credlyFetcherFor } = await import("./credly-store");
const { credlyFixtureFetcher } = await import("./credly-fixtures");
const { exportAccountData, EXPORT_VERSION } = await import("@/lib/account/export");

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
  /** Adds an accepted certificate and returns its proof id. */
  async function added(userId: string, goalId: string, over: Partial<CertificateSubmission> = {}) {
    const out = await submitCertificate(userId, cert(goalId, over), { today: TODAY, env, db: db!, members: noGroups });
    if (out.status !== "filled") throw new Error(`not filled: ${JSON.stringify(out)}`);
    expect(out.label).toBe("added");
    return out.proofId;
  }
  const check = (userId: string, proofId: string, f = fetcher) => checkCertificateWithCredly(userId, proofId, { fetcher: f, db: db!, env, today: TODAY });
  const proof = async (id: string) => (await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.id, id)))[0];
  const goalStatus = async (goalId: string) => (await db!.select({ status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.id, goalId)))[0].status;

  it("verifies a matching badge: verifier credly, a verified_at time, no reason, and the goal stays filled", async () => {
    const me = await person("match");
    const id = await added(me.userId, me.goalId);
    expect(await proof(id)).toMatchObject({ verifier: null, checkedAt: null, checkNote: null });
    const before = Date.now();
    expect(await check(me.userId, id)).toEqual({ status: "verified" });
    const p = await proof(id);
    expect(p).toMatchObject({ status: "accepted", verifier: "credly", checkNote: null });
    expect(p.verifiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(p.checkedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await goalStatus(me.goalId)).toBe("met");
  });

  it("verifies every row of the credential, one per skill the certificate proves", async () => {
    const me = await person("multi", "Priya", "Sharma", "aws");
    const [g2] = await db!.insert(schema.userGoals).values({ userId: me.userId, skillId: "system-design", position: 2 }).returning({ id: schema.userGoals.id });
    // A Solutions Architect badge would be needed for a real match; here the mismatch reason must reach both rows.
    const shared = { certId: "aws-solutions-architect-associate", credentialId: `SAA-${run}`, url: ownBadge().url };
    const a = await added(me.userId, me.goalId, shared);
    const b = await added(me.userId, g2.id, shared);
    expect(await check(me.userId, a)).toEqual({ status: "added", note: "badge_name" });
    expect((await proof(a)).checkNote).toBe("badge_name");
    expect((await proof(b)).checkNote).toBe("badge_name");
  });

  it("leaves a mismatch Added by you with a reason, and the goal still filled", async () => {
    const me = await person("mismatch");
    const id = await added(me.userId, me.goalId, { url: badge("07") });
    expect(await check(me.userId, id)).toEqual({ status: "added", note: "earner_name" });
    expect(await proof(id)).toMatchObject({ status: "accepted", verifier: null, checkNote: "earner_name" });
    expect(await goalStatus(me.goalId)).toBe("met");
    for (const [n, note] of [
      ["03", "badge_name"],
      ["04", "not_public"],
      ["05", "issuer"],
      ["06", "expired"],
      ["ff", "not_found"],
    ] as const) {
      const other = await person(`mismatch-${n}`);
      const pid = await added(other.userId, other.goalId, { url: badge(n) });
      expect(await check(other.userId, pid), n).toEqual({ status: "added", note });
    }
  });

  it("keeps a verification when Credly can't be reached, and says so on one that isn't verified", async () => {
    const me = await person("unreachable");
    const id = await added(me.userId, me.goalId);
    expect(await check(me.userId, id)).toEqual({ status: "verified" });
    const down = async () => ({ kind: "unreachable" as const });
    expect(await check(me.userId, id, down)).toEqual({ status: "verified" });
    expect(await proof(id)).toMatchObject({ verifier: "credly", checkNote: null });

    const them = await person("unreachable-new");
    const theirs = await added(them.userId, them.goalId, { url: badge("f0") });
    expect(await check(them.userId, theirs)).toEqual({ status: "added", note: "unreachable" });
    expect(await proof(theirs)).toMatchObject({ verifier: null, checkNote: "unreachable" });
  });

  it("turns a verified badge back to Added by you when Credly says it was taken back", async () => {
    const me = await person("revoked");
    const id = await added(me.userId, me.goalId);
    await check(me.userId, id);
    const revoked = async (badgeId: string) => ({ kind: "ok" as const, body: { data: { id: badgeId, state: "revoked", badge_template: { name: "x" } } } });
    expect(await check(me.userId, id, revoked)).toEqual({ status: "added", note: "not_public" });
    expect(await proof(id)).toMatchObject({ status: "accepted", verifier: null, checkNote: "not_public" });
    expect(await goalStatus(me.goalId)).toBe("met");
  });

  it("verifies one badge on one account only", async () => {
    const first = await person("badge-first");
    const second = await person("badge-second");
    const { url: one } = ownBadge();
    const a = await added(first.userId, first.goalId, { credentialId: `B1-${run}`, url: one });
    const b = await added(second.userId, second.goalId, { credentialId: `B2-${run}`, url: one });
    expect(await check(first.userId, a)).toEqual({ status: "verified" });
    expect(await check(second.userId, b)).toEqual({ status: "held" });
    expect((await proof(b)).verifier).toBeNull();
  });

  it("holds a badge already verified elsewhere for review, like a reused credential, so the first account can't lock the owner out", async () => {
    // Anyone can name an account after a badge's earner. The first to verify keeps it for now; the second is held for
    // review (not refused for good), and their goal waits for that review.
    const squatter = await person("squat-first");
    const owner = await person("squat-owner");
    const { url } = ownBadge();
    const a = await added(squatter.userId, squatter.goalId, { credentialId: `SQ1-${run}`, url });
    const b = await added(owner.userId, owner.goalId, { credentialId: `SQ2-${run}`, url });
    expect(await check(squatter.userId, a)).toEqual({ status: "verified" });
    expect(await goalStatus(owner.goalId)).toBe("met");
    expect(await check(owner.userId, b)).toEqual({ status: "held" });
    expect(await proof(b)).toMatchObject({ status: "pending", heldReason: "badge_reused", verifier: null, checkNote: "used_elsewhere" });
    expect(await goalStatus(owner.goalId)).toBe("active");
    // Held, it isn't checked again, and sending the certificate again keeps it held with one row.
    expect(await check(owner.userId, b)).toEqual({ status: "refused", reason: "not_found" });
    const again = await submitCertificate(owner.userId, cert(owner.goalId, { credentialId: `SQ2-${run}`, url }), { today: TODAY, env, db: db!, members: noGroups });
    expect(again).toEqual({ status: "held", skillId: "aws" });
    expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, owner.userId))).toHaveLength(1);
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
      const verified = await db!.select().from(schema.gapProofs).where(and(eq(schema.gapProofs.badgeId, (await proof(a)).badgeId!), eq(schema.gapProofs.verifier, "credly")));
      expect(verified).toHaveLength(1);
    }
  });

  it("never lets Verified outlive the badge: the expiry becomes the earlier of the typed date and Credly's", async () => {
    const expiring = (expires: string | null): CredlyFetcher => async (id) => {
      const f = await fetcher(id);
      return f.kind === "ok" ? { kind: "ok", body: { data: { ...(f.body as { data: object }).data, expires_at_date: expires } } } : f;
    };
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
      expect(await check(me.userId, id, expiring(theirs)), String(i)).toEqual({ status: "verified" });
      expect((await proof(id)).expiresOn, String(i)).toBe(stored);
      expect(await goalStatus(me.goalId)).toBe("met");
    }
  });

  it("checks only the person's own accepted Credly certificates", async () => {
    const me = await person("own");
    const them = await person("own-other");
    const id = await added(me.userId, me.goalId);
    expect(await check(them.userId, id)).toEqual({ status: "refused", reason: "not_found" });
    expect(await check(me.userId, "not-a-uuid")).toEqual({ status: "refused", reason: "not_found" });
    const ms = await person("own-ms");
    const msProof = await added(ms.userId, ms.goalId, { url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/ABC123" });
    expect(await check(ms.userId, msProof)).toEqual({ status: "refused", reason: "not_credly" });
    // A held proof (a credential another account used) isn't checked either.
    const held = await person("own-held");
    const out = await submitCertificate(held.userId, cert(held.goalId, { credentialId: `CRED-${me.goalId.slice(0, 8)}` }), { today: TODAY, env, db: db!, members: noGroups });
    expect(out.status).toBe("held");
    const [heldProof] = await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, held.userId));
    expect(await check(held.userId, heldProof.id)).toEqual({ status: "refused", reason: "not_found" });
  });

  it("counts checks against the daily limit, and calls nothing over it", async () => {
    const me = await person("limit");
    const id = await added(me.userId, me.goalId, { url: badge("07") });
    const fetcher = vi.fn(credlyFixtureFetcher);
    for (let i = 0; i < 10; i++) expect((await check(me.userId, id, fetcher)).status).toBe("added");
    expect(await check(me.userId, id, fetcher)).toEqual({ status: "refused", reason: "too_many" });
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("clears the check when the same certificate comes back with another link", async () => {
    const me = await person("relink");
    const id = await added(me.userId, me.goalId);
    await check(me.userId, id);
    expect((await proof(id)).verifier).toBe("credly");
    const again = await submitCertificate(me.userId, cert(me.goalId, { url: badge("07") }), { today: TODAY, env, db: db!, members: noGroups });
    expect(again).toMatchObject({ status: "filled", label: "added", proofId: id });
    expect(await proof(id)).toMatchObject({ verifier: null, checkedAt: null, checkNote: null, badgeId: "c4ed1100-0000-4000-8000-000000000007" });
    // The same link again keeps it.
    await check(me.userId, id);
    expect((await proof(id)).checkNote).toBe("earner_name");
  });

  it("logs only the outcome: no badge id, link or name", async () => {
    log.mockClear();
    const me = await person("logs");
    const id = await added(me.userId, me.goalId);
    await check(me.userId, id);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("certificate_check");
    expect(logged).not.toMatch(/c4ed1100|credly\.com|Priya|Sharma/);
  });

  it("is in the person's download, and goes with the account", async () => {
    const me = await person("export");
    const id = await added(me.userId, me.goalId);
    await check(me.userId, id);
    const data = await exportAccountData(me.userId, db! as never);
    expect(EXPORT_VERSION).toBe(14);
    expect(data!.exportVersion).toBe(14);
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
