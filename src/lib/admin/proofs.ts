import "server-only";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, certificateCredentials, gapProofs, users } from "@/db/schema";
import { certifications, skillGroupMembers } from "@/content";
import { shortName } from "@/lib/account/name";
import { lockPerson, refreshGoals } from "@/lib/goals/store";
import { credlyBadgePage } from "@/lib/proofs/credly";
import { logEvent } from "@/lib/log";
import {
  CLAIMED_ELSEWHERE,
  HELD_REASON_TEXT,
  HELD_REASONS,
  heldProofRow,
  heldProofView,
  proofReviewInput,
  type HeldProofView,
  type ProofReviewResult,
} from "@/lib/schemas/admin";

/*
 * The held-proof review page's data (/admin/proofs; FR-44, dev/held-proof-review-plan.md). Certificates held for review
 * because their credential id was already used on another account (submitCertificate) or their Credly badge is already
 * verified on another account (checkCertificateWithCredly). The caller has already checked the person is an admin
 * (src/lib/admin/server.ts); these functions take the admin's user id for the audit line.
 *
 * A claim is one person's held rows of one credential (one row per skill the certificate proves): the page lists one
 * line per claim, and a review settles all its rows. Accepting a claim rejects every competing claim on the same
 * credential or badge, accepted or waiting, so only one account ever holds it. Rejecting touches only that claim.
 * Logs and audit lines carry ids and outcomes only, never a name.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ProofAdminDeps = { db?: Db; members?: ReadonlyMap<string, string[]> };

const certById = new Map(certifications.map((c) => [c.id, c]));
const held = inArray(gapProofs.heldReason, [...HELD_REASONS]);

/** Held claims, oldest first, at most 200: one line per person and credential, never an email or the credential hash. */
export async function heldProofsForReview(deps: ProofAdminDeps = {}): Promise<HeldProofView[]> {
  const db = deps.db ?? getDb();
  // Competing holders are other accounts with the same credential or badge, accepted or waiting. Accounts waiting to
  // be deleted are left out of the list and the count. A held row with no credential hash (made before hashes were
  // kept) is a claim of its own, keyed by its id, and competes by its badge only.
  const rows = await db.execute(sql`
    select * from (
      select distinct on (p.user_id, p.cert_id, coalesce(p.credential_key, p.id::text))
        p.id, p.cert_id as "certId", p.evidence->>'issuer' as issuer, p.held_reason as "heldReason",
        to_char(p.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as submitted, p.badge_id as "badgeId",
        u.first_name as "firstName", u.last_name as "lastName", u.name, p.created_at,
        (select count(distinct o.user_id) from gap_proofs o join users ou on ou.id = o.user_id
          where o.user_id <> p.user_id and ou.deletion_requested_at is null and o.type = 'certification'
            and o.status in ('accepted', 'pending')
            and ((o.cert_id = p.cert_id and o.credential_key = p.credential_key) or (p.badge_id is not null and o.badge_id = p.badge_id))) as others
      from gap_proofs p join users u on u.id = p.user_id
      where p.type = 'certification' and p.status = 'pending' and p.held_reason in ('credential_reused', 'badge_reused')
        and p.cert_id is not null and u.deletion_requested_at is null
      order by p.user_id, p.cert_id, coalesce(p.credential_key, p.id::text), p.created_at, p.id
    ) c
    order by c.created_at, c.id
    limit 200`);
  return [...rows].map((raw) => {
    const r = heldProofRow.parse(raw);
    const cert = certById.get(r.certId);
    return heldProofView.parse({
      id: r.id,
      certificate: cert?.name ?? r.certId,
      issuer: cert?.issuer ?? r.issuer ?? "",
      reason: r.heldReason,
      reasonText: HELD_REASON_TEXT[r.heldReason],
      submittedOn: r.submitted,
      person: shortName(r),
      others: r.others,
      badgeUrl: r.badgeId ? credlyBadgePage(r.badgeId) : null,
    });
  });
}

export const PROOF_REVIEW_TEXT = {
  invalid: "That didn't work. Reload the page and try again.",
  not_found: "That proof isn't waiting for review any more. Reload the page to see the latest.",
  busy: "Someone else is reviewing this credential right now. Try again in a moment.",
} as const;

/** "Priya S." stays as it is; "Asha" gets a full stop. */
const sentence = (name: string) => (name.endsWith(".") ? name : `${name}.`);

type Claim = {
  userId: string;
  certId: string;
  /** Null for a held row made before credential hashes were kept: the claim is that one row. */
  credentialKey: string | null;
  rows: { id: string; skillId: string }[];
  badgeIds: string[];
};

/** The held claim a proof belongs to: that person's held rows of the same credential. Null once it isn't held. */
async function readClaim(db: Db | Tx, proofId: string): Promise<Claim | null> {
  const [proof] = await db
    .select({ userId: gapProofs.userId, certId: gapProofs.certId, credentialKey: gapProofs.credentialKey })
    .from(gapProofs)
    .where(and(eq(gapProofs.id, proofId), eq(gapProofs.type, "certification"), eq(gapProofs.status, "pending"), held));
  if (!proof?.certId) return null;
  const rows = await db
    .select({ id: gapProofs.id, skillId: gapProofs.skillId, badgeId: gapProofs.badgeId })
    .from(gapProofs)
    .where(
      and(
        eq(gapProofs.userId, proof.userId),
        eq(gapProofs.type, "certification"),
        eq(gapProofs.status, "pending"),
        held,
        eq(gapProofs.certId, proof.certId),
        proof.credentialKey ? eq(gapProofs.credentialKey, proof.credentialKey) : eq(gapProofs.id, proofId),
      ),
    );
  const badgeIds = [...new Set(rows.flatMap((r) => (r.badgeId ? [r.badgeId] : [])))].sort();
  return { userId: proof.userId, certId: proof.certId, credentialKey: proof.credentialKey, rows: rows.map((r) => ({ id: r.id, skillId: r.skillId })), badgeIds };
}

/** Other accounts' rows of the same credential or badge that are accepted or waiting. */
function competingRows(db: Db | Tx, claim: Claim) {
  const sameCredential = claim.credentialKey ? and(eq(gapProofs.certId, claim.certId), eq(gapProofs.credentialKey, claim.credentialKey)) : undefined;
  const sameBadge = claim.badgeIds.length ? inArray(gapProofs.badgeId, claim.badgeIds) : undefined;
  const either = sameCredential && sameBadge ? or(sameCredential, sameBadge) : (sameCredential ?? sameBadge ?? sql`false`);
  return db
    .select({ id: gapProofs.id, userId: gapProofs.userId, skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(
      and(
        ne(gapProofs.userId, claim.userId),
        eq(gapProofs.type, "certification"),
        inArray(gapProofs.status, ["accepted", "pending"]),
        either,
      ),
    );
}

type Outcome = { kind: "not_found" } | { kind: "retry"; people: string[] } | { kind: "done"; person: string; rows: number; competing: number; accounts: number };

/**
 * Accepts or rejects one held claim for the admin with this user id, in one transaction under the same locks the
 * proof code uses: each person's goal lock, taken in id order so two reviews can't wait on each other, then the
 * per-badge lock credly-store.ts takes after a person's lock. The people to lock are read first and checked again
 * under the locks; if a new competing account appeared in between, it starts again with that account locked too.
 *
 * Accept: the claim's rows are accepted as "Added by you" and fill the person's goals (Check with Credly verifies a
 * badge afterwards, the normal way); the credential is theirs (certificate_credentials); every competing row of the same
 * credential or badge on other accounts is rejected with held_reason "claimed_elsewhere" (or its own held reason) and
 * those goals are brought in line. Reject: the claim's rows are rejected, keeping their held reason, so the goal says
 * it couldn't be confirmed. One audit line per changed row: admin:<id>, an action and gap_proof:<id>.
 */
export async function reviewHeldProof(adminUserId: string, input: unknown, deps: ProofAdminDeps = {}): Promise<ProofReviewResult> {
  const parsed = proofReviewInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: PROOF_REVIEW_TEXT.invalid };
  const { proofId, decision } = parsed.data;
  const db = deps.db ?? getDb();
  const members = deps.members ?? skillGroupMembers;
  const actor = `admin:${adminUserId}`;
  let extra: string[] = [];
  let retries = 0;

  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = await readClaim(db, proofId);
    if (!seen) break;
    const people = new Set([seen.userId, ...extra]);
    if (decision === "accept") for (const r of await competingRows(db, seen)) people.add(r.userId);

    const out = await db.transaction(async (tx): Promise<Outcome> => {
      for (const id of [...people].sort()) await lockPerson(tx, id);
      const claim = await readClaim(tx, proofId);
      if (!claim || claim.userId !== seen.userId) return { kind: "not_found" };
      const now = new Date();
      const [account] = await tx.select({ name: users.name, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, claim.userId));
      const person = shortName(account ?? { name: null, firstName: null, lastName: null });
      const ids = claim.rows.map((r) => r.id);

      if (decision === "reject") {
        await tx
          .update(gapProofs)
          .set({ status: "rejected", verifier: null, verifiedAt: now })
          .where(inArray(gapProofs.id, ids));
        await tx.insert(auditLogs).values(ids.map((id) => ({ actor, action: "proof_rejected", target: `gap_proof:${id}` })));
        return { kind: "done", person, rows: ids.length, competing: 0, accounts: 0 };
      }

      for (const badgeId of claim.badgeIds) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credly-badge:${badgeId}`}))`);
      const competing = await competingRows(tx, claim);
      const unlocked = competing.filter((r) => !people.has(r.userId));
      if (unlocked.length) return { kind: "retry", people: [...people, ...unlocked.map((r) => r.userId)] };

      // Accepted as "Added by you": an admin's decision is not a Credly match. The old check is cleared, so the Check
      // with Credly button sets the verifier and Credly's expiry through the normal path (credly-store.ts).
      await tx
        .update(gapProofs)
        .set({ status: "accepted", heldReason: null, verifiedAt: now, verifier: null, checkNote: null, checkedAt: null })
        .where(inArray(gapProofs.id, ids));
      if (claim.credentialKey) {
        await tx
          .insert(certificateCredentials)
          .values({ certId: claim.certId, credentialKey: claim.credentialKey, userId: claim.userId })
          .onConflictDoUpdate({ target: [certificateCredentials.certId, certificateCredentials.credentialKey], set: { userId: claim.userId } });
      }
      if (competing.length) {
        await tx
          .update(gapProofs)
          .set({ status: "rejected", verifier: null, verifiedAt: now, heldReason: sql`coalesce(${gapProofs.heldReason}, ${CLAIMED_ELSEWHERE})` })
          .where(inArray(gapProofs.id, competing.map((r) => r.id)));
      }
      for (const skillId of new Set(claim.rows.map((r) => r.skillId))) await refreshGoals(tx, claim.userId, skillId, members);
      for (const key of new Set(competing.map((r) => `${r.userId}|${r.skillId}`))) {
        const [userId, skillId] = key.split("|") as [string, string];
        await refreshGoals(tx, userId, skillId, members);
      }
      await tx.insert(auditLogs).values([
        ...ids.map((id) => ({ actor, action: "proof_accepted", target: `gap_proof:${id}` })),
        ...competing.map((r) => ({ actor, action: "proof_rejected_claimed_elsewhere", target: `gap_proof:${r.id}` })),
      ]);
      return { kind: "done", person, rows: ids.length, competing: competing.length, accounts: new Set(competing.map((r) => r.userId)).size };
    });

    if (out.kind === "retry") {
      extra = out.people;
      retries++;
      continue;
    }
    if (out.kind === "not_found") break;
    logEvent("info", "proof_reviewed", { decision, rows: out.rows, competing: out.competing });
    if (decision === "reject") return { ok: true, message: `Rejected for ${sentence(out.person)} Their goal says the certificate couldn't be confirmed.` };
    const others = out.accounts ? ` The claim${out.accounts === 1 ? "" : "s"} on ${out.accounts} other account${out.accounts === 1 ? " was" : "s were"} rejected.` : "";
    return { ok: true, message: `Accepted for ${sentence(out.person)}${others}` };
  }
  if (retries === 4) return { ok: false, message: PROOF_REVIEW_TEXT.busy };
  logEvent("info", "proof_reviewed", { decision, result: "not_found" });
  return { ok: false, message: PROOF_REVIEW_TEXT.not_found };
}
