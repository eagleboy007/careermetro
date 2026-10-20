import { purgeDeletedAccounts } from "@/lib/account/delete";
import { clearExpiredUsernameRedirects } from "@/lib/account/settings-store";
import { clearPastOfferedTimes, endCompanyAccess, eraseClosedPhones } from "@/lib/corporate/cleanup";
import { clearOldProfileViews } from "@/lib/corporate/find-store";
import { clearExpiredCodes } from "@/lib/corporate/store";
import { clearOldDepartures } from "@/lib/departures/store";
import { renewExpiredGoals, reopenUnconfirmedGoals } from "@/lib/goals/store";
import { clearOldMockAnswers } from "@/lib/mock/interview-store";
import { clearOldPracticeAnswers } from "@/lib/practice/store";
import { deleteExpiredAnonymousResumes } from "@/lib/resume/ingest";
import { errorFields, logEvent, type LogFields } from "@/lib/log";
import { hasBearer } from "@/lib/secret";
import { clearOldRateLimits } from "@/lib/shared-limit";

/**
 * Daily job (vercel.json): deletes anonymous resumes and their profiles after 24 hours (FR-2), and accounts deleted
 * more than 30 days ago, for good. It also turns goals whose certificate expired to "renew" (dev/proof-plan.md rule 4), reopens goals still met by a
 * certificate that no longer counts (an unconfirmed Credly badge or a refused one), and forgets the work email on
 * codes that ran out (dev/corporate-plan.md). For the employer side (build step 7) it records each application's
 * 180-day company access end, erases phones shared for interviews once their application has closed, and deletes
 * offered interview times that passed unbooked; reads already enforce every one of these cutoffs. And it deletes old
 * usernames whose 14-day redirect is over (account settings part 2), company profile views older than 30 days
 * (pending item 19), practice answers and mock interview answers older than 30 days (handoff 12h, 12l), rate-limit windows over two days old,
 * and Departures posts closed more than 180 days ago with their saves, and feed runs over 90 days old
 * (docs/plans/departures-live-plan.md).
 */
export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set in the project.
  if (!hasBearer(request, process.env.CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  // Each runs whatever happens to the others, so one failing never holds up another's deletions. Every job answers
  // with counts only. (Log keys avoid words such as "email" and "phone", which the logger always redacts.)
  const jobs: Record<string, Promise<Record<string, number>>> = {
    anonymous: deleteExpiredAnonymousResumes().then((n) => ({ anonymousResumesDeleted: n })),
    accounts: purgeDeletedAccounts().then((n) => ({ accountsDeleted: n })),
    goals: renewExpiredGoals().then((n) => ({ peopleRenewed: n })),
    // Goals still met by a certificate that no longer counts (migration 0029, review B2); idempotent.
    unconfirmed: reopenUnconfirmedGoals().then((n) => ({ unconfirmedChecked: n })),
    codes: clearExpiredCodes().then((n) => ({ workCodesCleared: n })),
    companyAccess: endCompanyAccess(),
    sharedNumbers: eraseClosedPhones().then((n) => ({ sharedNumbersErased: n })),
    offeredTimes: clearPastOfferedTimes().then((n) => ({ offeredTimesDeleted: n })),
    // "oldLinks", not "usernames": the logger always redacts fields named after usernames.
    oldLinks: clearExpiredUsernameRedirects().then((n) => ({ oldLinksCleared: n })),
    profileViews: clearOldProfileViews().then((n) => ({ profileViewsCleared: n })),
    practice: clearOldPracticeAnswers().then((n) => ({ practiceAnswersDeleted: n })),
    // Mock interview answers after 30 days; the sessions keep their dates and summary (FR-50).
    mockAnswers: clearOldMockAnswers().then((n) => ({ mockAnswersDeleted: n })),
    rateLimits: clearOldRateLimits().then((n) => ({ rateLimitsCleared: n })),
    departures: clearOldDepartures(),
  };
  const empty: Record<string, Record<string, null>> = {
    anonymous: { anonymousResumesDeleted: null },
    accounts: { accountsDeleted: null },
    goals: { peopleRenewed: null },
    unconfirmed: { unconfirmedChecked: null },
    codes: { workCodesCleared: null },
    companyAccess: { accessEnded: null, readMarksCleared: null },
    sharedNumbers: { sharedNumbersErased: null },
    offeredTimes: { offeredTimesDeleted: null },
    oldLinks: { oldLinksCleared: null },
    profileViews: { profileViewsCleared: null },
    practice: { practiceAnswersDeleted: null },
    mockAnswers: { mockAnswersDeleted: null },
    rateLimits: { rateLimitsCleared: null },
    departures: { closedPostsDeleted: null, feedRunsDeleted: null },
  };
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  const counts: LogFields = {};
  let ok = true;
  settled.forEach((result, i) => {
    const job = names[i]!;
    if (result.status === "fulfilled") return void Object.assign(counts, result.value);
    ok = false;
    Object.assign(counts, empty[job]);
    logEvent("error", "cleanup_job_failed", { job, ...errorFields(result.reason) });
  });
  // Counts only, so each run can be checked from the logs.
  logEvent("info", "cleanup_done", counts);
  return Response.json(
    {
      ok,
      deleted: counts.anonymousResumesDeleted,
      accountsDeleted: counts.accountsDeleted,
      corporate: {
        accessEnded: counts.accessEnded,
        readMarksCleared: counts.readMarksCleared,
        sharedNumbersErased: counts.sharedNumbersErased,
        offeredTimesDeleted: counts.offeredTimesDeleted,
      },
    },
    { status: ok ? 200 : 500 },
  );
}
