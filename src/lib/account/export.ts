import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { exportApplications } from "@/lib/corporate/applications-store";
import { exportJobs } from "@/lib/corporate/jobs-store";
import { exportInterviewer } from "@/lib/corporate/interviews-store";
import { exportDiscovery } from "@/lib/corporate/find-store";
import { exportCorporate } from "@/lib/corporate/store";
import { exportInbox } from "@/lib/inbox/store";
import { exportJobChecks } from "@/lib/me/job-email-check";
import { exportDraft } from "@/lib/builder/store";
import { exportPlan } from "@/lib/elite/store";
import { exportNetwork } from "@/lib/network/store";
import { exportPractice } from "@/lib/practice/store";
import { exportSettings } from "./settings-store";
import { consents, gapAnalyses, gapProofs, jobChecks, jobDescriptions, paths, pathSteps, profiles, resumes, rideDays, roleProfiles, userGoals, users } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

/** Bumped when the shape of the download changes, so a person comparing two downloads can tell. */
export const EXPORT_VERSION = 22;

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
      username: users.username,
      usernameChangedAt: users.usernameChangedAt,
      headline: users.headline,
      city: users.city,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!account) return null;

  const resumeRows = await db
    // screening: the FR-34 layout flags and heading codes found at upload (counts and codes, never text).
    .select({ id: resumes.id, createdAt: resumes.createdAt, status: resumes.status, mimeType: resumes.mimeType, sizeBytes: resumes.sizeBytes, screening: resumes.screening, source: resumes.source })
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

  // Job checks keep only the skills a posting asked for; the posting text is never stored, so it can't be here.
  const jobCheckRows = resumeIds.length
    ? await db
        .select({
          id: jobChecks.id,
          resumeId: jobChecks.resumeId,
          role: jobChecks.roleSlug,
          company: jobChecks.company,
          title: jobChecks.title,
          requiredSkills: jobChecks.requiredSkillIds,
          niceToHaveSkills: jobChecks.niceSkillIds,
          unknownSkills: jobChecks.unknownSkills,
          createdAt: jobChecks.createdAt,
        })
        .from(jobChecks)
        .where(inArray(jobChecks.resumeId, resumeIds))
        .orderBy(asc(jobChecks.createdAt))
    : [];

  const [consentRows, goalRows, proofRows, rideRows, jdRows, inbox, companyRoles, jobsOwned, applicationRows, interviewer, settings, discovery, practiceRows, jobEmailCheckRows, network, builderDraft, plan] = await Promise.all([
    db.select({ purpose: consents.purpose, policyVersion: consents.policyVersion, givenAt: consents.givenAt, withdrawnAt: consents.withdrawnAt }).from(consents).where(eq(consents.userId, userId)).orderBy(asc(consents.givenAt)),
    db
      .select({
        skill: userGoals.skillId,
        source: userGoals.source,
        status: userGoals.status,
        position: userGoals.position,
        // A "Your choice" goal added from a job check names that check and its company.
        jobCheckId: userGoals.jobCheckId,
        jobCompany: jobChecks.company,
        metAt: userGoals.metAt,
        skippedAt: userGoals.skippedAt,
        // "Not for me" on a "one of these" goal: the skill of the group the person chose to learn instead (FR-48).
        swappedTo: userGoals.swappedTo,
        createdAt: userGoals.createdAt,
      })
      .from(userGoals)
      .leftJoin(jobChecks, eq(jobChecks.id, userGoals.jobCheckId))
      .where(eq(userGoals.userId, userId))
      .orderBy(asc(userGoals.position)),
    db
      .select({
        skill: gapProofs.skillId,
        type: gapProofs.type,
        status: gapProofs.status,
        evidence: gapProofs.evidence,
        certificate: gapProofs.certId,
        issuedOn: gapProofs.issuedOn,
        expiresOn: gapProofs.expiresOn,
        verifier: gapProofs.verifier,
        verifiedAt: gapProofs.verifiedAt,
        // The Credly check (dev/profile-certs-plan.md): the public badge id, when it was checked and why it wasn't verified.
        badgeId: gapProofs.badgeId,
        checkedAt: gapProofs.checkedAt,
        checkNote: gapProofs.checkNote,
        // Why a certificate was held for review; with status "rejected", it was rejected after review (FR-44).
        heldReason: gapProofs.heldReason,
        createdAt: gapProofs.createdAt,
      })
      .from(gapProofs)
      .where(eq(gapProofs.userId, userId))
      .orderBy(asc(gapProofs.createdAt)),
    db.select({ day: rideDays.day, tasks: rideDays.taskIds }).from(rideDays).where(eq(rideDays.userId, userId)).orderBy(asc(rideDays.day)),
    db.select({ createdAt: jobDescriptions.createdAt, text: jobDescriptions.rawText }).from(jobDescriptions).where(eq(jobDescriptions.userId, userId)).orderBy(asc(jobDescriptions.createdAt)),
    exportInbox(userId, db),
    exportCorporate(userId, db),
    exportJobs(userId, db),
    exportApplications(userId, db),
    exportInterviewer(userId, db),
    exportSettings(userId, db),
    exportDiscovery(userId, db),
    exportPractice(userId, db),
    exportJobChecks(userId, db),
    exportNetwork(userId, db, now),
    exportDraft(userId, db),
    exportPlan(userId, db),
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
    jobChecks: jobCheckRows,
    goals: goalRows,
    proofs: proofRows,
    rideDays: rideRows,
    inbox,
    // Company roles held on this account: company, role, since, the work-email domain and date (never the address).
    companyRoles,
    // Jobs this account posted for a company, with their Express apply criteria (it stays the company's when the account goes).
    jobsOwned,
    // Jobs this account applied to on CareerMetro: which companies have the application, the note sent with it (Express
    // apply), and every step it took.
    applications: applicationRows,
    // Interviews this account sat on for a company, and the feedback it wrote there (never the candidate's name).
    interviewer,
    // Privacy and notification choices (the defaults, with savedAt null, until you save some).
    settings: settings.settings,
    // Your current and expected pay, in lakh a year: only you ever see it.
    pay: settings.pay,
    // Usernames you gave up that still redirect to your profile, and until when.
    oldUsernames: settings.oldUsernames,
    // Let companies find me: whether it is on (also in settings), which companies opened your profile from a search
    // in the last 30 days and from which job, and the companies you blocked.
    companyDiscovery: { companiesCanFind: settings.settings.companiesCanFind, ...discovery },
    // Practice (handoff 12h): your answers from the last 30 days (older ones are deleted), newest first, each with its
    // question, the feedback in words (null when it wasn't available) and how sure you said you felt (1 Not yet to 4 Very).
    practiceAnswers: practiceRows,
    // Verified current job (FR-47): each work-email check of a job, with the company, the job's start month, the email's
    // domain (never the address), its state (verified, review: waiting for CareerMetro, or refused) and when.
    jobEmailChecks: jobEmailCheckRows,
    // Network (FR-49): whether people can find you by name, your connections, and the requests you sent and got, each
    // with the other person's name and username as shown to you and the dates.
    network,
    // Build your resume (FR-36): your saved answers and when you last changed them, or null. The phone number is never kept.
    builderDraft,
    // Your plan (FR-50): "elite" or "free", when you turned Elite on (null on Free), whether the Elite badge shows on
    // your profile, and when it last changed; null if you never turned Elite on. Free during the beta: nothing is billed.
    plan,
  };
}
