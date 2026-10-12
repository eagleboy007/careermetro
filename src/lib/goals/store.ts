import "server-only";
import { and, asc, count, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { certificateCredentials, gapAnalyses, gapProofs, jobChecks, paths, pathSteps, profiles, resumes, userGoals, users } from "@/db/schema";
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
import { checkCertificate } from "@/lib/proofs/rules";
import { currentAnalysis } from "@/lib/gaps/current";
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
async function provedSkills(userId: string, db: Db | Tx, today = indiaToday()): Promise<string[]> {
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
};
type GoalRow = {
  id: string;
  skillId: string;
  source: "gap" | "user";
  status: string;
  position: number;
  groupId: string | null;
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
async function refreshGoals(tx: Tx, userId: string, skillId: string, members: ReadonlyMap<string, string[]>, today = indiaToday()): Promise<void> {
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

/** Certificates one person may add in a day (dev/proof-plan.md, limits). */
export const DAILY_CERTIFICATES = 10;

/**
 * "Add a certificate" (dev/proof-plan.md). Runs the honesty rules, then:
 * - a certificate in the person's name, current and covering the goal is accepted at once and fills the goal;
 *   `verified` (the badge page confirmed it) labels it Verified, else Uploaded;
 * - one another account already used (same certificate and credential id) is held for review and fills nothing;
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

    const since = new Date(Date.now() - 24 * 3600_000);
    const [{ added }] = await tx
      .select({ added: count() })
      .from(gapProofs)
      .where(and(eq(gapProofs.userId, userId), eq(gapProofs.type, "certification"), gte(gapProofs.createdAt, since)));
    if (added >= DAILY_CERTIFICATES) return { status: "refused", reason: "too_many" };

    const key = credentialKey(cert!.id, submission.credentialId, opts.env);
    const mine = and(eq(gapProofs.userId, userId), eq(gapProofs.certId, cert!.id), eq(gapProofs.credentialKey, key), eq(gapProofs.skillId, check.skillId));
    const [own] = await tx.select({ id: gapProofs.id, status: gapProofs.status, verifier: gapProofs.verifier }).from(gapProofs).where(mine);
    // Sent again while held: still held, and no second row.
    if (own?.status === "pending") return { status: "held", skillId: check.skillId };
    if (own?.status === "accepted") {
      // The same certificate again, such as a renewal that keeps its credential id: the new dates and link replace
      // the old ones, so a goal waiting to be renewed is met again.
      await tx
        .update(gapProofs)
        .set({ issuedOn: submission.issuedOn, expiresOn: submission.expiresOn, evidence: { type: "certification", certId: cert!.id, issuer: cert!.issuer, url: submission.url } })
        .where(eq(gapProofs.id, own.id));
      await refreshGoals(tx, userId, check.skillId, members, today);
      return { status: "filled", label: own.verifier === "credly" ? "verified" : "uploaded", skillId: check.skillId };
    }

    const row = {
      userId,
      skillId: check.skillId,
      type: "certification" as const,
      evidence: { type: "certification" as const, certId: cert!.id, issuer: cert!.issuer, url: submission.url },
      certId: cert!.id,
      issuedOn: submission.issuedOn,
      expiresOn: submission.expiresOn,
      credentialKey: key,
      nameMatched: true,
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
      return { status: "held", skillId: check.skillId };
    }

    await tx.insert(gapProofs).values({ ...row, status: "accepted", verifier: opts.verified ? "credly" : null, verifiedAt: new Date() });
    await refreshGoals(tx, userId, check.skillId, members, today);
    return { status: "filled", label: opts.verified ? "verified" : "uploaded", skillId: check.skillId };
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
    if (gone.certId && gone.credentialKey) {
      const sameCredential = and(eq(gapProofs.userId, userId), eq(gapProofs.certId, gone.certId), eq(gapProofs.credentialKey, gone.credentialKey));
      const [still] = await tx.select({ id: gapProofs.id }).from(gapProofs).where(sameCredential).limit(1);
      if (!still)
        await tx
          .delete(certificateCredentials)
          .where(and(eq(certificateCredentials.userId, userId), eq(certificateCredentials.certId, gone.certId), eq(certificateCredentials.credentialKey, gone.credentialKey)));
    }
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
