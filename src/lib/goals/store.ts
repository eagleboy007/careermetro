import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, gapProofs, paths, pathSteps, profiles, resumes, userGoals } from "@/db/schema";
import { skills } from "@/content";
import { userGoal, proofEvidence, type Gap, type GapAnalysis, type UserGoal, type ProofEvidence, type ProofStatus } from "@/lib/schemas";
import { currentAnalysis } from "@/lib/gaps/current";
import { planGoalSync } from "./sync";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Goal changes for one person run one at a time: syncing and checking proof both read proof, then change goals, so
 * without this a proof rejected mid-sync could leave a goal met with no proof.
 */
async function lockPerson(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-goals:${userId}`}))`);
}

const implies = new Map(skills.map((s) => [s.id, s.implies]));
const knownSkill = new Set(skills.map((s) => s.id));

/** The skills this person has accepted proof for. Proof is per skill, so it counts for every role. */
async function provedSkills(userId: string, db: Db | Tx): Promise<string[]> {
  const rows = await db
    .selectDistinct({ skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(and(eq(gapProofs.userId, userId), eq(gapProofs.status, "accepted")));
  return rows.map((r) => r.skillId);
}

/**
 * Brings the person's goals in line with their current gap analysis (rules in ./sync.ts), links the analysis's path
 * steps to the goals, and returns every goal in order. Safe to run on every visit: it writes only what changed, and
 * two visits at once make the same goals once.
 */
export async function syncGoals(userId: string, analysis: { id: string; result: GapAnalysis }, db: Db = getDb()): Promise<UserGoal[]> {
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
    const [existing, proved] = await Promise.all([
      tx
        .select({ skillId: userGoals.skillId, position: userGoals.position, status: userGoals.status, source: userGoals.source })
        .from(userGoals)
        .where(eq(userGoals.userId, userId)),
      provedSkills(userId, tx),
    ]);
    const gaps: Gap[] = analysis.result.gaps.filter((g) => knownSkill.has(g.skillId));
    const plan = planGoalSync({ existing, gaps, metSkillIds: analysis.result.metSkillIds, provedSkillIds: proved, implies });

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
            metAt: g.status === "met" ? now : null,
          })),
        )
        .onConflictDoNothing();
    }
    for (const u of plan.update) {
      await tx
        .update(userGoals)
        .set({ status: u.status, metAt: u.status === "met" ? new Date() : null })
        .where(and(eq(userGoals.userId, userId), eq(userGoals.skillId, u.skillId)));
    }

    const rows = await tx
      .select({ id: userGoals.id, skillId: userGoals.skillId, source: userGoals.source, status: userGoals.status, position: userGoals.position })
      .from(userGoals)
      .where(eq(userGoals.userId, userId))
      .orderBy(asc(userGoals.position), asc(userGoals.createdAt));

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

    const provedSet = new Set(proved);
    return rows.map((r) => userGoal.parse({ ...r, proved: provedSet.has(r.skillId) }));
  });
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
    console.error("syncCurrentGoals failed", err instanceof Error ? err.name : "unknown");
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
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockPerson(tx, userId);
    const [proof] = await tx
      .update(gapProofs)
      .set({ status, verifier, verifiedAt: status === "pending" ? null : new Date() })
      .where(and(eq(gapProofs.id, proofId), eq(gapProofs.userId, userId)))
      .returning({ skillId: gapProofs.skillId });
    if (!proof) return false;
    const stillProved = (await provedSkills(userId, tx)).includes(proof.skillId);
    await tx
      .update(userGoals)
      .set(stillProved ? { status: "met", metAt: new Date() } : { status: "active", metAt: null })
      .where(and(eq(userGoals.userId, userId), eq(userGoals.skillId, proof.skillId), inArray(userGoals.status, stillProved ? ["active"] : ["met"])));
    return true;
  });
}
