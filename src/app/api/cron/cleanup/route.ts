import { purgeDeletedAccounts } from "@/lib/account/delete";
import { clearExpiredCodes } from "@/lib/corporate/store";
import { renewExpiredGoals } from "@/lib/goals/store";
import { deleteExpiredAnonymousResumes } from "@/lib/resume/ingest";
import { errorFields, logEvent } from "@/lib/log";
import { hasBearer } from "@/lib/secret";

/**
 * Daily job (vercel.json): deletes anonymous resumes and their profiles after 24 hours (FR-2), and accounts deleted
 * more than 30 days ago, for good. It also turns goals whose certificate expired to "renew" (dev/proof-plan.md rule 4), and forgets the work email on
 * codes that ran out (dev/corporate-plan.md).
 */
export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set in the project.
  if (!hasBearer(request, process.env.CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  // Each runs whatever happens to the other, so one failing never holds up the other's deletions.
  const [deleted, accountsDeleted, renewed, codes] = await Promise.allSettled([deleteExpiredAnonymousResumes(), purgeDeletedAccounts(), renewExpiredGoals(), clearExpiredCodes()]);
  if (deleted.status === "rejected") logEvent("error", "cleanup_anonymous_failed", errorFields(deleted.reason));
  if (accountsDeleted.status === "rejected") logEvent("error", "cleanup_accounts_failed", errorFields(accountsDeleted.reason));
  if (renewed.status === "rejected") logEvent("error", "cleanup_renew_failed", errorFields(renewed.reason));
  if (codes.status === "rejected") logEvent("error", "cleanup_codes_failed", errorFields(codes.reason));
  const ok = deleted.status === "fulfilled" && accountsDeleted.status === "fulfilled" && renewed.status === "fulfilled" && codes.status === "fulfilled";
  // Counts only, so each run can be checked from the logs.
  logEvent("info", "cleanup_done", {
    anonymousResumesDeleted: deleted.status === "fulfilled" ? deleted.value : null,
    accountsDeleted: accountsDeleted.status === "fulfilled" ? accountsDeleted.value : null,
    peopleRenewed: renewed.status === "fulfilled" ? renewed.value : null,
    workEmailCodesCleared: codes.status === "fulfilled" ? codes.value : null,
  });
  return Response.json(
    {
      ok,
      deleted: deleted.status === "fulfilled" ? deleted.value : null,
      accountsDeleted: accountsDeleted.status === "fulfilled" ? accountsDeleted.value : null,
    },
    { status: ok ? 200 : 500 },
  );
}
