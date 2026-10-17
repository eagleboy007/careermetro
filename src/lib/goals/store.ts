import "server-only";
import { and, arrayOverlaps, asc, count, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { certificateCredentials, gapAnalyses, gapProofs, jobChecks, paths, pathSteps, profiles, resources, resumes, userGoals, users } from "@/db/schema";
import { certifications, skillGroupMembers, skills } from "@/content";
import {
  userGoal,
  proofEvidence,
  type CertificateOutcome,
  type CertificateSubmission,
  type Gap,
  type GapAnalysis,
  type UserGoal,
  type ProofEvidence,
  type ProofStatus,
} from "@/lib/schemas";
import { resumeName } from "@/lib/account/name";
import { credentialKey } from "@/lib/proofs/credential";
import { credlyBadgeId } from "@/lib/proofs/credly";
import { checkCertificate } from "@/lib/proofs/rules";
import { currentAnalysis } from "@/lib/gaps/current";
import { canSwapTo, notForMeFor } from "./not-for-me";
import { fillingSkills, planGoalSync } from "./sync";
import { errorFields, logEvent } from "@/lib/log";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Goal changes for one person run one at a time: syncing and checking proof both read proof, then change goals, so
 * without this a proof rejected mid-sync could leave a goal met with no proof.
 */
export async function lockPerson(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-goals:${userId}`}))`);
}

const implies = new Map(skills.map((s) => [s.id, s.implies]));
const knownSkill = new Set(skills.map((s) => s.id));

/** Today in India as YYYY-MM-DD: a certificate is current through its expiry date there. */
export const indiaToday = (now = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

/**
 * The skills this person has current accepted proof for. Proof is per skill, so it counts for every role. A proof
 * past its expiry date no longer counts (dev/proof-plan.md rule 4).
 */
export async function provedSkills(userId: string, db: Db | Tx, today = indiaToday()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(and(eq(gapProofs.userId, userId), eq(gapProofs.status, "accepted"), or(isNull(gapProofs.expiresOn), gte(gapProofs.expiresOn, today))));
  return rows.map((r) => r.skillId);
}

/** Skills whose accepted proof has expired. Their goals read "renew" unless a current proof also covers them. */
async function expiredSkills(userId: string, db: Db | Tx, today = indiaToday()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(and(eq(gapProofs.userId, userId), eq(gapProofs.status, "accepted"), lt(gapProofs.expiresOn, today)));
  return rows.map((r) => r.skillId);
}

const goalColumns = {
  id: userGoals.id,
  skillId: userGoals.skillId,
  source: userGoals.source,
  status: userGoals.status,
  position: userGoals.position,
  groupId: userGoals.groupId,
  swappedTo: userGoals.swappedTo,
};
type GoalRow = {
  id: string;
  skillId: string;
  source: "gap" | "user";
  status: string;
  position: number;
  groupId: string | null;
  swappedTo: string | null;
  jobCheckId: string | null;
  company: string | null;
};

/** Every goal of the person in order, with the company of the job check a "Your choice" goal came from. */
function readGoals(db: Db | Tx, userId: string): Promise<GoalRow[]> {
  return db
    .select({ ...goalColumns, jobCheckId: userGoals.jobCheckId, company: jobChecks.company })
    .from(userGoals)
    .leftJoin(jobChecks, eq(jobChecks.id, userGoals.jobCheckId))
    .where(eq(userGoals.userId, userId))
    .orderBy(asc(userGoals.position), asc(userGoals.createdAt));
}

/**
 * Goals as the app reads them: a goal is proved when accepted proof covers its skill, or any skill of its group. A
 * "Your choice" goal (source "user") carries its job check's company while that check exists.
 */
function withProved(rows: GoalRow[], proved: string[], members: ReadonlyMap<string, string[]>): UserGoal[] {
  const provedSet = new Set(proved);
  return rows.map(({ groupId, company, ...r }) => {
    const proved = fillingSkills({ skillId: r.skillId, groupId }, members).some((id) => provedSet.has(id));
    return userGoal.parse({ ...r, groupId, proved, choice: r.source === "user" ? { company: company ?? null } : null });
  });
}

/**
 * Brings the person's goals in line with their current gap analysis (rules in ./sync.ts), links the analysis's path
 * steps to the goals, and returns every goal in order. Safe to run on every visit: it writes only what changed, and
 * two visits at once make the same goals once.
 */
export async function syncGoals(
  userId: string,
  analysis: { id: string; result: GapAnalysis },
  db: Db = getDb(),
  members: ReadonlyMap<string, string[]> = skillGroupMembers,
): Promise<UserGoal[]> {
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    // Only the person's own analysis may make their goals or link path steps to them.
    const [own] = await tx
      .select({ id: gapAnalyses.id })
      .from(gapAnalyses)
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(eq(gapAnalyses.id, analysis.id), eq(resumes.userId, userId)));
    if (!own) return [];
    const [existing, proved, expired] = await Promise.all([
      tx
        .select(goalColumns)
        .from(userGoals)
        .where(eq(userGoals.userId, userId)),
      provedSkills(userId, tx),
      expiredSkills(userId, tx),
    ]);
    const gaps: Gap[] = analysis.result.gaps.filter((g) => knownSkill.has(g.skillId));
    const plan = planGoalSync({ existing, gaps, metSkillIds: analysis.result.metSkillIds, provedSkillIds: proved, expiredSkillIds: expired, implies, members });

    if (plan.insert.length) {
      const now = new Date();
      await tx
        .insert(userGoals)
        .values(
          plan.insert.map((g) => ({
            userId,
            skillId: g.skillId,
            position: g.position,
            status: g.status,
            gapAnalysisId: analysis.id,
            groupId: g.groupId,
            metAt: g.status === "met" ? now : null,
          })),
        )
        .onConflictDoNothing();
    }
    for (const u of plan.update) {
      await tx
        .update(userGoals)
        .set({
          ...(u.status ? { status: u.status, metAt: u.status === "met" ? new Date() : null } : {}),
          ...(u.groupId !== undefined ? { groupId: u.groupId } : {}),
          ...(u.moveTo ? { skillId: u.moveTo } : {}),
        })
        .where(and(eq(userGoals.userId, userId), eq(userGoals.skillId, u.skillId)));
    }

    const rows = await readGoals(tx, userId);

    // Path steps for this analysis that don't point at a goal yet get the goal for their skill.
    const unlinked = await tx
      .select({ id: pathSteps.id, skillId: pathSteps.skillId })
      .from(pathSteps)
      .innerJoin(paths, eq(paths.id, pathSteps.pathId))
      .where(and(eq(paths.gapAnalysisId, analysis.id), isNull(pathSteps.goalId)));
    const goalBySkill = new Map(rows.map((r) => [r.skillId, r.id]));
    for (const [skillId, goalId] of goalBySkill) {
      const ids = unlinked.filter((s) => s.skillId === skillId).map((s) => s.id);
      if (ids.length) await tx.update(pathSteps).set({ goalId }).where(inArray(pathSteps.id, ids));
    }

    return withProved(rows, proved, members);
  });
}

/** The person's goals in order, read only: for checks that must not write, such as a tick. */
export async function goalsOf(
  userId: string,
  db: Db = getDb(),
  members: ReadonlyMap<string, string[]> = skillGroupMembers,
): Promise<UserGoal[]> {
  const [rows, proved] = await Promise.all([readGoals(db, userId), provedSkills(userId, db)]);
  return withProved(rows, proved, members);
}

/**
 * Makes goals from the person's current analysis, if there is one. Runs after sign-in and sign-up, so an anonymous
 * analysis that moved to the account gets its goals at once. Never fails the caller: goals are made again on the
 * next visit to the Map.
 */
export async function syncCurrentGoals(userId: string, db: Db = getDb()): Promise<void> {
  try {
    const analysis = await currentAnalysis(userId, db);
    if (analysis) await syncGoals(userId, analysis, db);
  } catch (err) {
    logEvent("error", "goals_sync_failed", errorFields(err));
  }
}

/**
 * Records a proof the person sent. It waits as pending until it is checked, and fills nothing until accepted. Work
 * proof must point at a role on one of the person's own saved profiles.
 */
export async function addProof(userId: string, skillId: string, evidence: ProofEvidence, db: Db = getDb()): Promise<string | null> {
  const parsed = proofEvidence.safeParse(evidence);
  if (!parsed.success || !knownSkill.has(skillId)) return null;
  if (parsed.data.type === "work") {
    const [own] = await db
      .select({ data: profiles.data })
      .from(profiles)
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(eq(profiles.id, parsed.data.profileId), eq(resumes.userId, userId)));
    if (!own || parsed.data.roleIndex >= (own.data.roles?.length ?? 0)) return null;
  }
  const [row] = await db.insert(gapProofs).values({ userId, skillId, type: parsed.data.type, evidence: parsed.data }).returning({ id: gapProofs.id });
  return row.id;
}

/**
 * Brings the goals a skill's proof can fill in line with the person's proof: met while current accepted proof covers
 * the goal, "renew" when only expired proof does, else open again. Skipped goals are left alone. The caller holds the
 * person's lock.
 */
export async function refreshGoals(tx: Tx, userId: string, skillId: string, members: ReadonlyMap<string, string[]>, today = indiaToday()): Promise<void> {
  const [proved, expired] = await Promise.all([provedSkills(userId, tx, today).then((r) => new Set(r)), expiredSkills(userId, tx, today).then((r) => new Set(r))]);
  // The goal for this skill, and any goal whose group has it.
  const groups = [...members].filter(([, ids]) => ids.includes(skillId)).map(([id]) => id);
  const goals = await tx
    .select({ id: userGoals.id, skillId: userGoals.skillId, groupId: userGoals.groupId, status: userGoals.status })
    .from(userGoals)
    .where(and(eq(userGoals.userId, userId), groups.length ? or(eq(userGoals.skillId, skillId), inArray(userGoals.groupId, groups)) : eq(userGoals.skillId, skillId)));
  // A goal the current resume meets stays met whatever its certificate does, so the renew job and the next sync
  // don't flip it back and forth.
  let resumeMet: Set<string> | null = null;
  for (const g of goals) {
    if (g.status === "skipped") continue;
    const filling = fillingSkills(g, members);
    let want: "met" | "renew" | "active" = filling.some((id) => proved.has(id)) ? "met" : filling.some((id) => expired.has(id)) ? "renew" : "active";
    if (want !== "met" && g.status === "met") {
      resumeMet ??= new Set((await currentAnalysis(userId, tx as unknown as Db))?.result.metSkillIds ?? []);
      if (filling.some((id) => resumeMet!.has(id))) want = "met";
    }
    if (want === g.status) continue;
    await tx
      .update(userGoals)
      .set({ status: want, metAt: want === "met" ? new Date() : null })
      .where(eq(userGoals.id, g.id));
  }
}

/**
 * Sets a proof's status after it is checked. Accepting it fills the gap: the person's goal for that skill is met.
 * Rejecting or reopening a proof that was accepted opens the goal again unless another accepted proof still covers
 * the skill; the next sync marks it met again if their resume shows the skill. Only the proof's owner is matched.
 */
export async function setProofStatus(
  proofId: string,
  userId: string,
  status: ProofStatus,
  verifier: "app" | "credly" | "issuer" | "person" | null,
  db: Db = getDb(),
  members: ReadonlyMap<string, string[]> = skillGroupMembers,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const [proof] = await tx
      .update(gapProofs)
      .set({ status, verifier, verifiedAt: status === "pending" ? null : new Date() })
      .where(and(eq(gapProofs.id, proofId), eq(gapProofs.userId, userId)))
      .returning({ skillId: gapProofs.skillId });
    if (!proof) return false;
    await refreshGoals(tx, userId, proof.skillId, members);
    return true;
  });
}

/**
 * Holds some of a person's accepted proofs for review (status pending with a reason), the same way a reused credential
 * is held: they stop filling goals until someone reviews them, and the goals they filled are brought in line. `extra`
 * sets other columns on the same rows. The caller holds the person's lock. Returns how many rows were held.
 */
export async function holdProofs(
  tx: Tx,
  userId: string,
  where: SQL | undefined,
  reason: string,
  extra: Partial<typeof gapProofs.$inferInsert> = {},
  members: ReadonlyMap<string, string[]> = skillGroupMembers,
): Promise<number> {
  const held = await tx
    .update(gapProofs)
    .set({ ...extra, status: "pending", heldReason: reason, verifier: null, verifiedAt: null })
    .where(and(eq(gapProofs.userId, userId), eq(gapProofs.status, "accepted"), where))
    .returning({ skillId: gapProofs.skillId });
  for (const skillId of new Set(held.map((h) => h.skillId))) await refreshGoals(tx, userId, skillId, members);
  if (held.length) logEvent("info", "certificate_held", { reason });
  return held.length;
}

/** Brings the goals of these skills in line with the person's proof. The caller holds the person's lock. */
export async function refreshSkills(tx: Tx, userId: string, skillIds: Iterable<string>, members: ReadonlyMap<string, string[]> = skillGroupMembers, today = indiaToday()): Promise<void> {
  for (const skillId of new Set(skillIds)) await refreshGoals(tx, userId, skillId, members, today);
}

/**
 * Checks of one Credly badge run one at a time across accounts (a lock per badge, always taken after the person's), so
 * two accounts can't both take the same badge at once.
 */
export async function lockBadge(tx: Tx, badgeId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`credly-badge:${badgeId}`}))`);
}

/**
 * One badge, one account (T48, T50): whether another live account already has this Credly badge accepted or verified.
 * Accounts waiting out their deletion window don't count, and purged ones are gone with their proofs. Needs no network,
 * so it runs even when Credly can't be checked. The caller holds the badge's lock.
 */
export async function badgeElsewhere(tx: Tx, userId: string, badgeId: string): Promise<boolean> {
  const [other] = await tx
    .select({ id: gapProofs.id })
    .from(gapProofs)
    .innerJoin(users, eq(users.id, gapProofs.userId))
    .where(
      and(
        eq(gapProofs.badgeId, badgeId),
        ne(gapProofs.userId, userId),
        or(eq(gapProofs.status, "accepted"), eq(gapProofs.verifier, "credly")),
        isNull(users.deletionRequestedAt),
      ),
    )
    .limit(1);
  return !!other;
}

/**
 * The credential is free again once none of the person's proofs of it is left standing (deleted or refused), so the
 * real owner can still use it.
 */
export async function releaseCredential(tx: Tx, userId: string, certId: string, key: string): Promise<void> {
  const [still] = await tx
    .select({ id: gapProofs.id })
    .from(gapProofs)
    .where(and(eq(gapProofs.userId, userId), eq(gapProofs.certId, certId), eq(gapProofs.credentialKey, key), ne(gapProofs.status, "rejected")))
    .limit(1);
  if (!still)
    await tx
      .delete(certificateCredentials)
      .where(and(eq(certificateCredentials.userId, userId), eq(certificateCredentials.certId, certId), eq(certificateCredentials.credentialKey, key)));
}

/** Certificates one person may add in a day (dev/proof-plan.md, limits). */
export const DAILY_CERTIFICATES = 10;

/**
 * "Add a certificate" (dev/proof-plan.md). Runs the honesty rules, then:
 * - a certificate in the person's name, current and covering the goal is accepted at once and fills the goal,
 *   labelled "added" (Added by you), unless its link is a Credly badge: that one waits as "pending" (check pending)
 *   and fills nothing until the Credly check after this transaction confirms it (src/lib/proofs/credly-store.ts);
 *   `verified` is for callers that already checked it;
 * - one another account already used (same certificate and credential id, or a Credly badge another live account
 *   has) is held for review and fills nothing;
 * - anything else is refused with a reason and nothing is stored.
 * The credential id and the name on the certificate are never stored; only a keyed hash of the id is.
 */
export async function submitCertificate(
  userId: string,
  submission: CertificateSubmission,
  opts: { verified?: boolean; today?: string; env?: Record<string, string | undefined>; db?: Db; members?: ReadonlyMap<string, string[]> } = {},
): Promise<CertificateOutcome> {
  const db = opts.db ?? getDb();
  const members = opts.members ?? skillGroupMembers;
  const today = opts.today ?? indiaToday();
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const [goal] = await tx
      .select({ skillId: userGoals.skillId, groupId: userGoals.groupId, status: userGoals.status })
      .from(userGoals)
      .where(and(eq(userGoals.id, submission.goalId), eq(userGoals.userId, userId)));
    if (!goal || goal.status === "skipped") return { status: "refused", reason: "not_found" };

    const [account] = await tx.select({ name: users.name, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId));
    const cert = certifications.find((c) => c.id === submission.certId);
    const check = checkCertificate({ submission, cert, fillingSkills: fillingSkills(goal, members), accountName: resumeName(account ?? null), today, env: opts.env });
    if (!check.ok) return { status: "refused", reason: check.reason };

    const key = credentialKey(cert!.id, submission.credentialId, opts.env);
    const badgeId = credlyBadgeId(submission.url);
    // Rejected after review (the held-proof review keeps the held reason on the rejected row): the same credential or
    // badge from the same person is settled, so it isn't sent to review again; Grievances is the way to dispute it.
    const sameClaim = badgeId ? or(and(eq(gapProofs.certId, cert!.id), eq(gapProofs.credentialKey, key)), eq(gapProofs.badgeId, badgeId)) : and(eq(gapProofs.certId, cert!.id), eq(gapProofs.credentialKey, key));
    // Likewise a credential Credly showed in another earner's name: sent again (with any link), it is refused with the
    // name-mismatch message, which also points to Grievances (review B1).
    const sameCredential = and(eq(gapProofs.certId, cert!.id), eq(gapProofs.credentialKey, key));
    const [settled] = await tx
      .select({ heldReason: gapProofs.heldReason })
      .from(gapProofs)
      .where(
        and(
          eq(gapProofs.userId, userId),
          eq(gapProofs.type, "certification"),
          eq(gapProofs.status, "rejected"),
          or(and(isNotNull(gapProofs.heldReason), sameClaim), and(eq(gapProofs.checkNote, "earner_name"), sameCredential)),
        ),
      )
      .orderBy(sql`${gapProofs.heldReason} is null`)
      .limit(1);
    if (settled) return { status: "refused", reason: settled.heldReason ? "reviewed" : "name" };

    const since = new Date(Date.now() - 24 * 3600_000);
    const [{ added }] = await tx
      .select({ added: count() })
      .from(gapProofs)
      .where(and(eq(gapProofs.userId, userId), eq(gapProofs.type, "certification"), gte(gapProofs.createdAt, since)));
    if (added >= DAILY_CERTIFICATES) return { status: "refused", reason: "too_many" };

    // A Credly badge link fills nothing until a Credly check confirms it (decision of 2026-10-13): it waits as "check
    // pending" and the caller checks it after this transaction. Other verify links are accepted as before.
    const waitsForCredly = !!badgeId && !opts.verified;
    // One badge, one account (rule 3, T48): a badge another live account already has is held for review before any
    // Credly call, the same way a reused credential is.
    if (badgeId) await lockBadge(tx, badgeId);
    const reused = badgeId ? await badgeElsewhere(tx, userId, badgeId) : false;
    const evidence = { type: "certification" as const, certId: cert!.id, issuer: cert!.issuer, url: submission.url };
    const mine = and(
      eq(gapProofs.userId, userId),
      eq(gapProofs.certId, cert!.id),
      eq(gapProofs.credentialKey, key),
      eq(gapProofs.skillId, check.skillId),
      ne(gapProofs.status, "rejected"),
    );
    const [own] = await tx
      .select({ id: gapProofs.id, status: gapProofs.status, heldReason: gapProofs.heldReason, verifier: gapProofs.verifier, evidence: gapProofs.evidence })
      .from(gapProofs)
      .where(mine);
    // Sent again while held for review: still held, and no second row.
    if (own?.status === "pending" && own.heldReason !== "credly_check") return { status: "held", skillId: check.skillId, reason: own.heldReason === "badge_reused" ? "badge" : "credential" };
    if (own) {
      // The same certificate again, such as a renewal that keeps its credential id: the new dates and link replace
      // the old ones, so a goal waiting to be renewed is met again. A new link clears the old Credly check, since it
      // was about the old link; a Credly link not yet confirmed waits for its check again.
      const sameLink = own.evidence.type === "certification" && own.evidence.url === submission.url;
      const verified = own.verifier === "credly" && sameLink;
      const dates = { issuedOn: submission.issuedOn, expiresOn: submission.expiresOn, evidence };
      const recheck = sameLink ? {} : { verifier: null, verifiedAt: null, badgeId, checkedAt: null, checkNote: null };
      if (reused && !verified) {
        await tx
          .update(gapProofs)
          .set({ ...dates, ...recheck, status: "pending", heldReason: "badge_reused", verifier: null, verifiedAt: null, checkNote: "used_elsewhere" })
          .where(eq(gapProofs.id, own.id));
        await refreshGoals(tx, userId, check.skillId, members, today);
        logEvent("info", "certificate_held", { reason: "badge_reused" });
        return { status: "held", skillId: check.skillId, reason: "badge" };
      }
      if (waitsForCredly && !verified) {
        await tx
          .update(gapProofs)
          .set({ ...dates, ...recheck, status: "pending", heldReason: "credly_check", verifier: null, verifiedAt: null })
          .where(eq(gapProofs.id, own.id));
        await refreshGoals(tx, userId, check.skillId, members, today);
        return { status: "pending", skillId: check.skillId, proofId: own.id };
      }
      await tx
        .update(gapProofs)
        .set({ ...dates, ...recheck, status: "accepted", heldReason: null, ...(own.status === "accepted" ? {} : { verifiedAt: new Date() }) })
        .where(eq(gapProofs.id, own.id));
      await refreshGoals(tx, userId, check.skillId, members, today);
      return { status: "filled", label: verified ? "verified" : "added", skillId: check.skillId, proofId: own.id };
    }

    const row = {
      userId,
      skillId: check.skillId,
      type: "certification" as const,
      evidence,
      certId: cert!.id,
      issuedOn: submission.issuedOn,
      expiresOn: submission.expiresOn,
      credentialKey: key,
      nameMatched: true,
      badgeId,
    };
    // Rule 3: the first account to use a credential owns it, for every skill its certificate proves. Another account
    // sending it at the same moment waits on this row's key and then finds it taken.
    await tx.insert(certificateCredentials).values({ certId: cert!.id, credentialKey: key, userId }).onConflictDoNothing();
    const [owner] = await tx
      .select({ userId: certificateCredentials.userId })
      .from(certificateCredentials)
      .where(and(eq(certificateCredentials.certId, cert!.id), eq(certificateCredentials.credentialKey, key)));
    if (owner?.userId !== userId) {
      await tx.insert(gapProofs).values({ ...row, status: "pending", heldReason: "credential_reused" });
      logEvent("info", "certificate_held", { reason: "credential_reused" });
      return { status: "held", skillId: check.skillId, reason: "credential" };
    }
    if (reused) {
      await tx.insert(gapProofs).values({ ...row, status: "pending", heldReason: "badge_reused", checkNote: "used_elsewhere" });
      logEvent("info", "certificate_held", { reason: "badge_reused" });
      return { status: "held", skillId: check.skillId, reason: "badge" };
    }
    if (waitsForCredly) {
      const [waiting] = await tx.insert(gapProofs).values({ ...row, status: "pending", heldReason: "credly_check" }).returning({ id: gapProofs.id });
      return { status: "pending", skillId: check.skillId, proofId: waiting.id };
    }

    const [inserted] = await tx
      .insert(gapProofs)
      .values({ ...row, status: "accepted", verifier: opts.verified ? "credly" : null, verifiedAt: new Date(), checkedAt: opts.verified ? new Date() : null })
      .returning({ id: gapProofs.id });
    await refreshGoals(tx, userId, check.skillId, members, today);
    return { status: "filled", label: opts.verified ? "verified" : "added", skillId: check.skillId, proofId: inserted.id };
  });
}

/** The person removes one of their proofs; the goals it filled open again unless other proof covers them. */
export async function deleteProof(userId: string, proofId: string, db: Db = getDb(), members: ReadonlyMap<string, string[]> = skillGroupMembers): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const [gone] = await tx
      .delete(gapProofs)
      .where(and(eq(gapProofs.id, proofId), eq(gapProofs.userId, userId)))
      .returning({ skillId: gapProofs.skillId, certId: gapProofs.certId, credentialKey: gapProofs.credentialKey });
    if (!gone) return false;
    // The credential stays theirs while another of their proofs uses it; with none left it is free again.
    if (gone.certId && gone.credentialKey) await releaseCredential(tx, userId, gone.certId, gone.credentialKey);
    await refreshGoals(tx, userId, gone.skillId, members);
    return true;
  });
}

/**
 * Daily job (rule 4): goals filled by a certificate that expired in the last 30 days turn to "renew", unless another
 * current proof covers them. The window catches up a missed day without rescanning every old proof. Returns how many
 * people were updated.
 */
export async function renewExpiredGoals(today = indiaToday(), db: Db = getDb(), members: ReadonlyMap<string, string[]> = skillGroupMembers): Promise<number> {
  const from = new Date(new Date(`${today}T00:00:00Z`).getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const expired = await db
    .selectDistinct({ userId: gapProofs.userId, skillId: gapProofs.skillId })
    .from(gapProofs)
    .innerJoin(userGoals, and(eq(userGoals.userId, gapProofs.userId), eq(userGoals.status, "met")))
    .where(and(eq(gapProofs.status, "accepted"), lt(gapProofs.expiresOn, today), gte(gapProofs.expiresOn, from)));
  const people = new Set<string>();
  for (const e of expired) {
    await db.transaction(async (tx) => {
      await lockPerson(tx, e.userId);
      await refreshGoals(tx, e.userId, e.skillId, members, today);
    });
    people.add(e.userId);
  }
  return people.size;
}

/**
 * Daily job, and the one-off step after migration 0029 (review B2): goals still "met" by a certificate that no longer
 * counts (waiting for its Credly check, held for review, or refused) are brought in line, each under the person's
 * lock. A goal their resume or another current proof meets stays met, so running it again changes nothing. Returns how
 * many people were looked at.
 */
export async function reopenUnconfirmedGoals(
  db: Db = getDb(),
  members: ReadonlyMap<string, string[]> = skillGroupMembers,
  /** Only these people (tests share one database). */
  only?: string[],
): Promise<number> {
  const stale = await db
    .selectDistinct({ userId: gapProofs.userId, skillId: gapProofs.skillId })
    .from(gapProofs)
    .innerJoin(userGoals, and(eq(userGoals.userId, gapProofs.userId), eq(userGoals.status, "met")))
    .where(
      and(
        eq(gapProofs.type, "certification"),
        or(eq(gapProofs.status, "rejected"), and(eq(gapProofs.status, "pending"), isNotNull(gapProofs.heldReason))),
        only ? inArray(gapProofs.userId, only) : undefined,
      ),
    );
  const people = new Set<string>();
  for (const s of stale) {
    await db.transaction(async (tx) => {
      await lockPerson(tx, s.userId);
      await refreshGoals(tx, s.userId, s.skillId, members);
    });
    people.add(s.userId);
  }
  return people.size;
}

/**
 * "Remove from my goals": the person drops one of their own "Your choice" goals. It is skipped, not deleted, like any
 * goal the person sets aside, so it leaves the line and no longer counts toward their limit; adding the skill again
 * brings it back. Goals from gaps are never touched here. False for anyone else's goal, a gap goal or one already
 * removed.
 */
export async function removeChoiceGoal(userId: string, goalId: string, db: Db = getDb()): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(goalId)) return false;
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const gone = await tx
      .update(userGoals)
      .set({ status: "skipped", skippedAt: new Date() })
      .where(and(eq(userGoals.id, goalId), eq(userGoals.userId, userId), eq(userGoals.source, "user"), ne(userGoals.status, "skipped")))
      .returning({ id: userGoals.id });
    return gone.length > 0;
  });
}

/** "Not for me" on a goal from a gap (FR-48): skip a required goal, swap a group goal, or bring a skipped one back. */
export type GoalChange = { action: "skip" } | { action: "swap"; skillId: string } | { action: "restore" };

/**
 * Applies "Not for me" to one of the person's goals from gaps (docs/plans/not-for-me-plan.md). Skip sets aside a
 * required goal that isn't met: it stays a gap, so the match and readiness don't change, and goal sync never brings it
 * back. Swap points a "one of these" goal at another skill of its group (back to its own skill clears it); any skill of
 * the group still fills it. Restore brings a skipped goal back at the end of the order, with its proof. False for
 * anyone else's goal, a "Your choice" goal, or a change that doesn't fit the goal.
 */
export async function changeGoal(
  userId: string,
  goalId: string,
  change: GoalChange,
  db: Db = getDb(),
  members: ReadonlyMap<string, string[]> = skillGroupMembers,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(goalId)) return false;
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const [goal] = await tx
      .select(goalColumns)
      .from(userGoals)
      .where(and(eq(userGoals.id, goalId), eq(userGoals.userId, userId), eq(userGoals.source, "gap")));
    if (!goal) return false;
    const offer = notForMeFor({ ...goal, source: "gap" }, "", members);
    const where = eq(userGoals.id, goal.id);
    if (change.action === "skip") {
      if (offer?.kind !== "skip" || (goal.status !== "active" && goal.status !== "renew")) return false;
      await tx.update(userGoals).set({ status: "skipped", skippedAt: new Date() }).where(where);
      return true;
    }
    if (change.action === "swap") {
      if (goal.status === "skipped" || !canSwapTo({ ...goal, source: "gap" }, change.skillId, members)) return false;
      await tx
        .update(userGoals)
        .set({ swappedTo: change.skillId === goal.skillId ? null : change.skillId })
        .where(where);
      return true;
    }
    if (goal.status !== "skipped") return false;
    const [{ last }] = await tx
      .select({ last: sql<number>`coalesce(max(${userGoals.position}), 0)::int` })
      .from(userGoals)
      .where(eq(userGoals.userId, userId));
    // Active until the next sync, which marks it met if its skill is shown or proved.
    await tx.update(userGoals).set({ status: "active", skippedAt: null, metAt: null, position: last + 1 }).where(where);
    return true;
  });
}

export type SwapResource = { id: string; title: string; provider: string; kind: string; minutes: number };

/**
 * Courses for skills a goal was swapped to, which the person's path has no step for: healthy free links first, then
 * shortest, at most three per skill, like the path builder picks them. Read only.
 */
export async function resourcesForSkills(skillIds: string[], db: Db | Tx = getDb()): Promise<Map<string, SwapResource[]>> {
  const out = new Map<string, SwapResource[]>();
  if (!skillIds.length) return out;
  const rows = await db
    .select({ id: resources.id, title: resources.title, provider: resources.provider, kind: resources.kind, minutes: resources.minutes, free: resources.free, skillIds: resources.skillIds })
    .from(resources)
    .where(and(eq(resources.healthy, true), arrayOverlaps(resources.skillIds, skillIds)));
  for (const skillId of skillIds) {
    const picked = rows
      .filter((r) => r.skillIds.includes(skillId) && r.title.trim())
      .sort((a, b) => Number(b.free) - Number(a.free) || a.minutes - b.minutes || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map(({ id, title, provider, kind, minutes }) => ({ id, title, provider, kind, minutes }));
    out.set(skillId, picked);
  }
  return out;
}

/**
 * Skills with a certificate rejected after review (/admin/proofs, FR-44): status rejected with a held reason. The goals
 * they would fill say the certificate couldn't be confirmed and point to Grievances. Read only.
 */
export async function notConfirmedSkills(userId: string, db: Db | Tx = getDb()): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(and(eq(gapProofs.userId, userId), eq(gapProofs.type, "certification"), eq(gapProofs.status, "rejected"), isNotNull(gapProofs.heldReason)));
  return new Set(rows.map((r) => r.skillId));
}
