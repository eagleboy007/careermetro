import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapProofs, users } from "@/db/schema";
import { certifications } from "@/content";
import { resumeName } from "@/lib/account/name";
import { localMockActive } from "@/lib/ai/local-mock";
import { holdProofs, indiaToday, lockPerson } from "@/lib/goals/store";
import { logEvent } from "@/lib/log";
import type { CredlyCheckOutcome } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { credlyBadgeId, fetchCredlyBadge, readCredlyBadge, type CredlyFetcher } from "./credly";
import { credlyFixtureFetcher } from "./credly-fixtures";

type Db = ReturnType<typeof getDb>;
type Env = Record<string, string | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The network fetcher, or the recorded fixtures in local test mode (never production), which makes no call at all. */
export const credlyFetcherFor = (env: Env = process.env): CredlyFetcher => (localMockActive(env) ? credlyFixtureFetcher : (id) => fetchCredlyBadge(id));

/**
 * Checks one of the person's accepted certificate proofs against its Credly badge (pending item 13,
 * dev/profile-certs-plan.md), after it is added or when the owner presses "Check with Credly". Three steps, so no
 * lock or connection is held across the network: (1) under the person's lock, read the proof and count the check
 * against the limits (takeShared on the transaction); (2) fetch and compare; (3) under the lock again, write the result
 * to every row of that credential still on the same link.
 *
 * A match marks it verified (verifier 'credly', verified_at now), and its expiry becomes the earlier of the typed date and
 * the badge's. A mismatch or a definite failure leaves it "Added by you" with the reason. Credly not answering never
 * takes a verification away. A badge already verified on another account is held for review, like a reused credential,
 * and stops filling the goal until then. Otherwise the goal is filled or not exactly as before. Logs carry only the
 * outcome.
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
      .select({ certId: gapProofs.certId, credentialKey: gapProofs.credentialKey, evidence: gapProofs.evidence, status: gapProofs.status, verifier: gapProofs.verifier })
      .from(gapProofs)
      .where(and(eq(gapProofs.id, proofId), eq(gapProofs.userId, userId), eq(gapProofs.type, "certification")));
    if (!proof || proof.status !== "accepted" || proof.evidence.type !== "certification") return { ok: false as const, refused: "not_found" as const };
    const url = proof.evidence.url;
    const badgeId = url ? credlyBadgeId(url) : null;
    const cert = certifications.find((c) => c.id === proof.certId);
    if (!url || !badgeId || !cert) return { ok: false as const, refused: "not_credly" as const };
    // Both limits are counted inside this transaction, on its connection.
    const mine = await takeShared(LIMITS.credlyChecksPerUser, userId, { db: tx });
    const everyone = mine && (await takeShared(LIMITS.credlyChecksAll, "all", { db: tx }));
    if (!everyone) return { ok: false as const, refused: "too_many" as const };
    const [account] = await tx.select({ name: users.name, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId));
    return { ok: true as const, url, badgeId, cert, certId: proof.certId!, credentialKey: proof.credentialKey, accountName: resumeName(account ?? null) };
  });
  if (!start.ok) {
    logEvent("info", "certificate_check", { result: `refused_${start.refused}` });
    return { status: "refused", reason: start.refused };
  }

  const fetcher = opts.fetcher ?? credlyFetcherFor(env);
  const { note, expires } = await readCredlyBadge(start.badgeId, { cert: start.cert, accountName: start.accountName, today: opts.today ?? indiaToday(), env, fetcher });

  const outcome = await db.transaction(async (tx): Promise<CredlyCheckOutcome> => {
    await lockPerson(tx, userId);
    // Every row of this credential (one per skill it proves) that is still accepted and on the same link.
    const sameCredential = and(
      eq(gapProofs.userId, userId),
      eq(gapProofs.type, "certification"),
      eq(gapProofs.status, "accepted"),
      eq(gapProofs.certId, start.certId),
      start.credentialKey ? eq(gapProofs.credentialKey, start.credentialKey) : eq(gapProofs.id, proofId),
      sql`${gapProofs.evidence}->>'url' = ${start.url}`,
    );
    const at = now();
    if (note === null) {
      // One badge, one account. Checks of the same badge from two accounts run one at a time (a lock per badge, taken
      // after the person's), so both can't verify it at once. A badge already verified for someone else is held for
      // review, as a reused credential is: anyone can name an account after the badge's earner, so the first to verify
      // must not lock the real owner out for good, and neither is settled until someone looks.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credly-badge:${start.badgeId}`}))`);
      const [elsewhere] = await tx
        .select({ id: gapProofs.id })
        .from(gapProofs)
        .where(and(eq(gapProofs.badgeId, start.badgeId), eq(gapProofs.verifier, "credly"), ne(gapProofs.userId, userId)))
        .limit(1);
      if (elsewhere) {
        const held = await holdProofs(tx, userId, sameCredential, "badge_reused", { checkedAt: at, checkNote: "used_elsewhere", badgeId: start.badgeId });
        return held ? { status: "held" } : { status: "refused", reason: "not_found" };
      }
      // Verified never outlives the badge: the expiry becomes the earlier of the typed date and Credly's.
      const done = await tx
        .update(gapProofs)
        .set({
          verifier: "credly",
          verifiedAt: at,
          checkedAt: at,
          checkNote: null,
          badgeId: start.badgeId,
          ...(expires ? { expiresOn: sql`least(coalesce(${gapProofs.expiresOn}, ${expires}::date), ${expires}::date)` } : {}),
        })
        .where(sameCredential)
        .returning({ id: gapProofs.id });
      return done.length ? { status: "verified" } : { status: "refused", reason: "not_found" };
    }
    if (note === "unreachable") {
      // Not an answer about the badge: a verification already made stands.
      const kept = await tx
        .update(gapProofs)
        .set({ checkedAt: at })
        .where(and(sameCredential, eq(gapProofs.verifier, "credly")))
        .returning({ id: gapProofs.id });
      if (kept.length) return { status: "verified" };
    }
    const done = await tx
      .update(gapProofs)
      .set({ verifier: null, checkedAt: at, checkNote: note, badgeId: start.badgeId })
      .where(sameCredential)
      .returning({ id: gapProofs.id });
    return done.length ? { status: "added", note } : { status: "refused", reason: "not_found" };
  });
  logEvent("info", "certificate_check", { result: outcome.status === "added" ? outcome.note : outcome.status === "refused" ? `refused_${outcome.reason}` : outcome.status });
  return outcome;
}
