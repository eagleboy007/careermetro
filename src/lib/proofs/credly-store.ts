import "server-only";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { gapProofs, users } from "@/db/schema";
import { certifications } from "@/content";
import { resumeName } from "@/lib/account/name";
import { localMockActive } from "@/lib/ai/local-mock";
import { badgeElsewhere, indiaToday, lockBadge, lockPerson, refreshSkills, releaseCredential } from "@/lib/goals/store";
import { logEvent } from "@/lib/log";
import type { CredlyCheckOutcome } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { credlyBadgeId, fetchCredlyBadge, readCredlyBadge, type CredlyFetcher } from "./credly";
import { credlyFixtureFetcher } from "./credly-fixtures";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The network fetcher, or the recorded fixtures in local test mode (never production), which makes no call at all. */
export const credlyFetcherFor = (env: Env = process.env): CredlyFetcher => (localMockActive(env) ? credlyFixtureFetcher : (id) => fetchCredlyBadge(id));

/**
 * Proofs a Credly check may act on: accepted ones, ones waiting for their check ("check pending"), and ones held
 * because the badge was on another account, so the owner can ask again once it no longer is (T50).
 */
const checkable = () => or(eq(gapProofs.status, "accepted"), and(eq(gapProofs.status, "pending"), inArray(gapProofs.heldReason, ["credly_check", "badge_reused"])));

/** The rows of one credential (one per skill it proves) a check acts on: the person's, on the same link. */
const credentialRows = (userId: string, proofId: string, certId: string, credentialKey: string | null, url: string) =>
  and(
    eq(gapProofs.userId, userId),
    eq(gapProofs.type, "certification"),
    checkable(),
    eq(gapProofs.certId, certId),
    credentialKey ? eq(gapProofs.credentialKey, credentialKey) : eq(gapProofs.id, proofId),
    sql`${gapProofs.evidence}->>'url' = ${url}`,
  );

/** Sets every row of one credential and brings the goals they fill in line. Returns how many rows changed. */
async function setCredential(tx: Tx, userId: string, where: SQL | undefined, values: PgUpdateSetSource<typeof gapProofs>): Promise<number> {
  const rows = await tx.update(gapProofs).set(values).where(where).returning({ skillId: gapProofs.skillId });
  await refreshSkills(tx, userId, rows.map((r) => r.skillId));
  return rows.length;
}

/** Holds the credential for review because another live account has the badge (rule 3), like a reused credential. */
const holdReused = (tx: Tx, userId: string, where: SQL | undefined, badgeId: string, at: Date) =>
  setCredential(tx, userId, where, { status: "pending", heldReason: "badge_reused", verifier: null, verifiedAt: null, checkedAt: at, checkNote: "used_elsewhere", badgeId });

/**
 * Checks one of the person's certificate proofs against its Credly badge (pending item 13, dev/profile-certs-plan.md),
 * after it is added or when the owner presses "Check with Credly". Three steps, so no lock or connection is held across
 * the network: (1) under the person's lock, read the proof, apply one badge per account (no network needed) and count
 * the check against the limits (takeShared on the transaction); (2) fetch and compare; (3) under the lock again, write
 * the result to every row of that credential still on the same link.
 *
 * A Credly badge fills its goal only once Credly confirms it (decision of 2026-10-13, under Milin's rule: in the
 * person's name, current, and covering the goal):
 * - a match is accepted and verified (verifier 'credly') and fills the goal;
 * - another earner's name is refused as a name mismatch (status rejected) and fills nothing;
 * - a badge Credly shows as expired, matching otherwise, stays accepted with Credly's date, so its goal reads Renew;
 * - any other definite answer leaves it "Added by you, check pending", filling nothing;
 * - Credly not answering changes nothing: a verification stands, a pending one stays pending.
 * Every definite answer brings the expiry down to Credly's date when that is earlier (T49). A badge another live
 * account already has is held for review; once that account no longer has it, a check releases the hold (T50). Logs
 * carry only the outcome.
 */
export async function checkCertificateWithCredly(
  userId: string,
  proofId: string,
  opts: { fetcher?: CredlyFetcher; db?: Db; env?: Env; today?: string; now?: () => Date } = {},
): Promise<CredlyCheckOutcome> {
  if (!UUID.test(proofId)) return { status: "refused", reason: "not_found" };
  const db = opts.db ?? getDb();
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date());

  const start = await db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const [proof] = await tx
      .select({ certId: gapProofs.certId, credentialKey: gapProofs.credentialKey, evidence: gapProofs.evidence, verifier: gapProofs.verifier })
      .from(gapProofs)
      .where(and(eq(gapProofs.id, proofId), eq(gapProofs.userId, userId), eq(gapProofs.type, "certification"), checkable()));
    if (!proof || proof.evidence.type !== "certification") return { ok: false as const, refused: "not_found" as const };
    const url = proof.evidence.url;
    const badgeId = url ? credlyBadgeId(url) : null;
    const cert = certifications.find((c) => c.id === proof.certId);
    if (!url || !badgeId || !cert) return { ok: false as const, refused: "not_credly" as const };
    // One badge, one account, before any limit or network call: a badge another live account has is held (or stays
    // held). A verification this account already holds came first, so it stands.
    await lockBadge(tx, badgeId);
    if (proof.verifier !== "credly" && (await badgeElsewhere(tx, userId, badgeId))) {
      const held = await holdReused(tx, userId, credentialRows(userId, proofId, proof.certId!, proof.credentialKey, url), badgeId, now());
      return held ? { ok: false as const, held: true as const } : { ok: false as const, refused: "not_found" as const };
    }
    // Both limits are counted inside this transaction, on its connection.
    const mine = await takeShared(LIMITS.credlyChecksPerUser, userId, { db: tx });
    const everyone = mine && (await takeShared(LIMITS.credlyChecksAll, "all", { db: tx }));
    if (!everyone) return { ok: false as const, refused: "too_many" as const };
    const [account] = await tx.select({ name: users.name, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId));
    return { ok: true as const, url, badgeId, cert, certId: proof.certId!, credentialKey: proof.credentialKey, accountName: resumeName(account ?? null) };
  });
  if (!start.ok) {
    const out: CredlyCheckOutcome = "held" in start ? { status: "held" } : { status: "refused", reason: start.refused };
    logEvent("info", "certificate_check", { result: out.status === "refused" ? `refused_${out.reason}` : out.status });
    return out;
  }

  const fetcher = opts.fetcher ?? credlyFetcherFor(env);
  const { note, expires } = await readCredlyBadge(start.badgeId, { cert: start.cert, accountName: start.accountName, today: opts.today ?? indiaToday(), env, fetcher });

  const outcome = await db.transaction(async (tx): Promise<CredlyCheckOutcome> => {
    await lockPerson(tx, userId);
    const rows = credentialRows(userId, proofId, start.certId, start.credentialKey, start.url);
    const at = now();
    const gone: CredlyCheckOutcome = { status: "refused", reason: "not_found" };
    // A badge never counts past the date Credly holds: the expiry becomes the earlier of the typed date and Credly's.
    const expiry = expires ? { expiresOn: sql`least(coalesce(${gapProofs.expiresOn}, ${expires}::date), ${expires}::date)` } : {};

    if (note === null || (note === "expired" && expires)) {
      // Checks of one badge from two accounts run one at a time, so both can't take it at once. A badge another live
      // account already has is held for review: anyone can name an account after the badge's earner, so the first
      // must not lock the real owner out for good, and neither is settled until someone looks.
      await lockBadge(tx, start.badgeId);
      const [mineVerified] = await tx
        .select({ id: gapProofs.id })
        .from(gapProofs)
        .where(and(rows, eq(gapProofs.verifier, "credly")))
        .limit(1);
      if (!mineVerified && (await badgeElsewhere(tx, userId, start.badgeId))) return (await holdReused(tx, userId, rows, start.badgeId, at)) ? { status: "held" } : gone;
      if (note === null) {
        const n = await setCredential(tx, userId, rows, { status: "accepted", heldReason: null, verifier: "credly", verifiedAt: at, checkedAt: at, checkNote: null, badgeId: start.badgeId, ...expiry });
        return n ? { status: "verified" } : gone;
      }
      // Expired on Credly: still the person's, with Credly's date, so the goal reads Renew (rule 4, T49).
      const n = await setCredential(tx, userId, rows, { status: "accepted", heldReason: null, verifier: null, verifiedAt: at, checkedAt: at, checkNote: "expired", badgeId: start.badgeId, ...expiry });
      return n ? { status: "added", note: "expired" } : gone;
    }

    if (note === "earner_name") {
      // Milin's rule: a certificate counts only in the person's own name. Refused the way a typed name mismatch is, so
      // it fills nothing, and the credential is free again for its real owner.
      const n = await setCredential(tx, userId, rows, { status: "rejected", heldReason: null, verifier: null, verifiedAt: null, checkedAt: at, checkNote: "earner_name", badgeId: start.badgeId, ...expiry });
      if (start.credentialKey) await releaseCredential(tx, userId, start.certId, start.credentialKey);
      return n ? { status: "rejected", reason: "name" } : gone;
    }

    if (note === "unreachable") {
      // Not an answer about the badge: a verification already made stands, an older accepted certificate stays as it
      // was, and one waiting for its check keeps waiting.
      const kept = await tx
        .update(gapProofs)
        .set({ checkedAt: at })
        .where(and(rows, eq(gapProofs.verifier, "credly")))
        .returning({ id: gapProofs.id });
      if (kept.length) return { status: "verified" };
      const older = await tx
        .update(gapProofs)
        .set({ checkedAt: at, checkNote: note })
        .where(and(rows, eq(gapProofs.status, "accepted")))
        .returning({ id: gapProofs.id });
      if (older.length) return { status: "added", note };
    }

    // Not confirmed: "Added by you, check pending", filling nothing until a check confirms it.
    const n = await setCredential(tx, userId, rows, {
      status: "pending",
      heldReason: "credly_check",
      verifier: null,
      verifiedAt: null,
      checkedAt: at,
      checkNote: note,
      badgeId: start.badgeId,
      ...(note === "unreachable" ? {} : expiry),
    });
    return n ? { status: "pending", note } : gone;
  });
  logEvent("info", "certificate_check", {
    result: outcome.status === "added" || outcome.status === "pending" ? `${outcome.status}_${outcome.note}` : outcome.status === "refused" ? `refused_${outcome.reason}` : outcome.status,
  });
  return outcome;
}
