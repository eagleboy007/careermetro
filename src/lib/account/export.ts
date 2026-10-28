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
import { exportDepartures } from "@/lib/departures/store";
import { exportMyJobs } from "@/lib/my-jobs/store";
import { exportPlan } from "@/lib/elite/store";
import { exportJobSearch } from "@/lib/job-search/store";
import { exportLibrary } from "@/lib/library/store";
import { exportMeEdits } from "@/lib/me/edit-store";
import { exportMockSessions } from "@/lib/mock/interview-store";
import { exportTimedTests } from "@/lib/mock/store";
import { exportNetwork } from "@/lib/network/store";
import { exportNotifications } from "@/lib/notifications/store";
import { exportPractice } from "@/lib/practice/store";
import { isSampleResume } from "@/lib/resume/sample-mime";
import { exportAvailability } from "./availability-store";
import { exportSettings } from "./settings-store";
import { consents, gapAnalyses, gapProofs, jobChecks, jobDescriptions, paths, pathSteps, profiles, resumes, rideDays, roleProfiles, userGoals, users } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

/** Bumped when the shape of the download changes, so a person comparing two downloads can tell. */
export const EXPORT_VERSION = 33;

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
          // From version 33, a job added from "Add a job you found": its link, where it came from, its city and your own
          // copy of the description (null for the Gaps page's checks, which keep no text).
          url: jobChecks.url,
          source: jobChecks.source,
          city: jobChecks.city,
          description: jobChecks.description,
          createdAt: jobChecks.createdAt,
        })
        .from(jobChecks)
        .where(inArray(jobChecks.resumeId, resumeIds))
        .orderBy(asc(jobChecks.createdAt))
    : [];

  const [consentRows, goalRows, proofRows, rideRows, jdRows, inbox, companyRoles, jobsOwned, applicationRows, interviewer, settings, discovery, practiceRows, jobEmailCheckRows, network, builderDraft, plan, timedTestRows, mockSessionRows, jobSearch, departureRows, myJobRows, libraryRows, meEdits, notificationRows, availability] = await Promise.all([
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
    exportTimedTests(userId, db),
    exportMockSessions(userId, db),
    exportJobSearch(userId, db),
    exportDepartures(userId, db),
    exportMyJobs(userId, db),
    exportLibrary(userId, db),
    exportMeEdits(userId, db),
    exportNotifications(userId, db),
    exportAvailability(userId, db),
  ]);

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    note: "Everything CareerMetro holds about you. Your original resume file is never kept, so it isn't included.",
    account,
    consents: consentRows,
    // Nested as the app uses them: resume, its profile versions, each version's gap analyses and their paths.
    // sample: true (from version 32) marks the made-up sample resume ("Try a sample resume"), so it never reads as the person's (T114).
    resumes: resumeRows.map((r) => ({
      ...r,
      sample: isSampleResume(r.mimeType),
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
    // apply), Open to work in as it was sent with it (from version 31), and every step it took.
    applications: applicationRows,
    // Interviews this account sat on for a company, and the feedback it wrote there (never the candidate's name).
    interviewer,
    // Privacy and notification choices (the defaults, with savedAt null, until you save some). From version 31 they
    // include messageRequests (message requests from people who aren't connections) and openToWorkIn (Remote and the
    // cities you are open to work in).
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
    // Timed tests (FR-50): the role, the bank question ids, your pick for each (-1 is no answer), when it started and
    // ended, and how many were right. Picked and scored by code, never by AI.
    timedTests: timedTestRows,
    // Mock interviews (FR-50): the role, length, focus, the bank question ids, when it started and ended, and the
    // summary in words; with each answer still kept (answers go after 30 days) and what worked and what to add next
    // time, and from version 30 the follow-up asked after it (followUp: the question and your reply, null when
    // skipped; null when none was asked). The questions and follow-ups come from the bank, never from AI; no score.
    mockSessions: mockSessionRows,
    // Job search (handoff 6): whether "Looking for a job" is on, your notice period in days and the day you resigned
    // (null when not given). Only you ever see these; companies you apply to see only Can join.
    jobSearch,
    // Departures (docs/plans/departures-live-plan.md): the roles from company job boards you saved or marked as applied,
    // with the post's title, company, place and link, when you saved it, how far it went (Applied, Heard back,
    // Interview or Offer) and when you applied, and whether it has closed on the company's board.
    departures: departureRows,
    // My jobs (from version 33, docs/plans/application-tracker-plan.md): every job in your list, from our company job
    // boards or added by you from any site, with its company, title, place and link, its status (Saved, Applied, Heard
    // back, Interview, Offer, Not this time or Withdrawn) and dates, your private note, and your own copy of the
    // description of a job you added. Only you ever see these.
    myJobs: myJobRows,
    // Library (docs/plans/library-part-2-plan.md): the resources you saved, ticked "I finished this" on and added to your
    // rides, each with its title, link and when; the links you reported, with the reason you picked and what a reviewer
    // decided (there is no note); and the links you suggested, with what a reviewer decided.
    library: libraryRows.library,
    resourceReports: libraryRows.resourceReports,
    resourceSuggestions: libraryRows.resourceSuggestions,
    // Me editing (docs/plans/me-editing-plan.md): the roles and education you added by hand, your stories with the boxes
    // you sorted them into and the skill of the goal each is linked to, and your interests.
    meRoles: meEdits.meRoles,
    meEducation: meEdits.meEducation,
    stories: meEdits.stories,
    interests: meEdits.interests,
    // Notifications (docs/plans/notifications-plan.md): each one's kind, when it was made and read, and the company and
    // job for the ones about an application or interview. Other people's names are left out.
    notifications: notificationRows,
    // Your availability (from version 31): the weekday hours you said you are usually free ("mon 17:00"). Only you see
    // them; they only pre-tick times when a company asks for times.
    availability,
  };
}
