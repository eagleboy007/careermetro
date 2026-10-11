import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { exportInbox } from "@/lib/inbox/store";
import { consents, gapAnalyses, gapProofs, jobDescriptions, paths, pathSteps, profiles, resumes, rideDays, roleProfiles, userGoals, users } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

/** Bumped when the shape of the download changes, so a person comparing two downloads can tell. */
export const EXPORT_VERSION = 2;

/**
 * Everything we hold about the person, for "Download your data" (DPDP Act right to access). The original resume file
 * is never kept, so it isn't here; nor are keyed hashes (name, network address), which mean nothing outside our
 * systems. Plain data only, so it can go straight to JSON.
 */
export async function exportAccountData(userId: string, db: Db = getDb(), now = new Date()) {
  const [account] = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      name: users.name,
      weeklyHours: users.weeklyHours,
      createdAt: users.createdAt,
      ageConfirmedAt: users.ageConfirmedAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!account) return null;

  const resumeRows = await db
    .select({ id: resumes.id, createdAt: resumes.createdAt, status: resumes.status, mimeType: resumes.mimeType, sizeBytes: resumes.sizeBytes })
    .from(resumes)
    .where(eq(resumes.userId, userId))
    .orderBy(asc(resumes.createdAt));
  const resumeIds = resumeRows.map((r) => r.id);
  const profileRows = resumeIds.length
    ? await db
        .select({ id: profiles.id, resumeId: profiles.resumeId, version: profiles.version, confirmedByUser: profiles.confirmedByUser, createdAt: profiles.createdAt, data: profiles.data })
        .from(profiles)
        .where(inArray(profiles.resumeId, resumeIds))
        .orderBy(asc(profiles.createdAt))
    : [];
  const profileIds = profileRows.map((p) => p.id);
  const analysisRows = profileIds.length
    ? await db
        .select({ id: gapAnalyses.id, profileId: gapAnalyses.profileId, role: roleProfiles.slug, createdAt: gapAnalyses.createdAt, rating: gapAnalyses.userRating, result: gapAnalyses.result })
        .from(gapAnalyses)
        .leftJoin(roleProfiles, eq(roleProfiles.id, gapAnalyses.roleProfileId))
        .where(inArray(gapAnalyses.profileId, profileIds))
        .orderBy(asc(gapAnalyses.createdAt))
    : [];
  const analysisIds = analysisRows.map((a) => a.id);
  const pathRows = analysisIds.length
    ? await db
        .select({ id: paths.id, gapAnalysisId: paths.gapAnalysisId, weeklyHours: paths.weeklyHours, createdAt: paths.createdAt })
        .from(paths)
        .where(inArray(paths.gapAnalysisId, analysisIds))
        .orderBy(asc(paths.createdAt))
    : [];
  const pathIds = pathRows.map((p) => p.id);
  const stepRows = pathIds.length
    ? await db
        .select({ pathId: pathSteps.pathId, position: pathSteps.position, skill: pathSteps.skillId, kind: pathSteps.kind, hours: pathSteps.hours, reason: pathSteps.reason, proofTask: pathSteps.proofTask, doneAt: pathSteps.doneAt })
        .from(pathSteps)
        .where(inArray(pathSteps.pathId, pathIds))
        .orderBy(asc(pathSteps.pathId), asc(pathSteps.position))
    : [];

  const [consentRows, goalRows, proofRows, rideRows, jdRows, inbox] = await Promise.all([
    db.select({ purpose: consents.purpose, policyVersion: consents.policyVersion, givenAt: consents.givenAt, withdrawnAt: consents.withdrawnAt }).from(consents).where(eq(consents.userId, userId)).orderBy(asc(consents.givenAt)),
    db
      .select({ skill: userGoals.skillId, source: userGoals.source, status: userGoals.status, position: userGoals.position, metAt: userGoals.metAt, skippedAt: userGoals.skippedAt, createdAt: userGoals.createdAt })
      .from(userGoals)
      .where(eq(userGoals.userId, userId))
      .orderBy(asc(userGoals.position)),
    db
      .select({ skill: gapProofs.skillId, type: gapProofs.type, status: gapProofs.status, evidence: gapProofs.evidence, verifiedAt: gapProofs.verifiedAt, createdAt: gapProofs.createdAt })
      .from(gapProofs)
      .where(eq(gapProofs.userId, userId))
      .orderBy(asc(gapProofs.createdAt)),
    db.select({ day: rideDays.day, tasks: rideDays.taskIds }).from(rideDays).where(eq(rideDays.userId, userId)).orderBy(asc(rideDays.day)),
    db.select({ createdAt: jobDescriptions.createdAt, text: jobDescriptions.rawText }).from(jobDescriptions).where(eq(jobDescriptions.userId, userId)).orderBy(asc(jobDescriptions.createdAt)),
    exportInbox(userId, db),
  ]);

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    note: "Everything CareerMetro holds about you. Your original resume file is never kept, so it isn't included.",
    account,
    consents: consentRows,
    // Nested as the app uses them: resume, its profile versions, each version's gap analyses and their paths.
    resumes: resumeRows.map((r) => ({
      ...r,
      profiles: profileRows
        .filter((p) => p.resumeId === r.id)
        .map((p) => ({
          ...p,
          gapAnalyses: analysisRows
            .filter((a) => a.profileId === p.id)
            .map((a) => ({
              ...a,
              paths: pathRows.filter((x) => x.gapAnalysisId === a.id).map((x) => ({ ...x, steps: stepRows.filter((st) => st.pathId === x.id) })),
            })),
        })),
    })),
    jobDescriptions: jdRows,
    goals: goalRows,
    proofs: proofRows,
    rideDays: rideRows,
    inbox,
  };
}
