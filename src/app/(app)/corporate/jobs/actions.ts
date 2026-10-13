"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { JOB_ERROR_TEXT, reportJob, saveJob, setJobStatus, type JobResult } from "@/lib/corporate/jobs-store";
import type { JobFormValues, JobHonestyTicks, JobSaveResult } from "@/lib/corporate/types";
import type { ReportReason } from "@/lib/schemas/inbox";

/*
 * Jobs' server actions (dev/corporate-plan.md build step 3). Each checks who is signed in; the store validates the
 * input with Zod and re-reads the person's live company role and job team itself. Answers are words to show. Nothing
 * here logs input.
 */

const SIGN_IN = "Please sign in again.";

const words = (r: JobResult): string | null => (r.ok ? null : (r.message ?? JOB_ERROR_TEXT[r.error]));

/** Saves the Post a job form, and opens the job when the ticks come with it. The form moves on itself. */
export async function saveJobAction(values: JobFormValues, open: JobHonestyTicks | null): Promise<JobSaveResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: SIGN_IN };
  // The store's schema drops what it doesn't take (the status shown on the form); the status changes only by rule.
  const r = await saveJob(account.id, { ...values, jobId: values.jobId ?? undefined, ...(open ? { open } : {}) });
  return r.ok ? { ok: true, jobId: r.jobId } : { ok: false, error: words(r)! };
}

/** Pause, close, or open again; Corporate reloads its list on success. */
export async function setJobStatusAction(jobId: string, to: "open" | "paused" | "closed"): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await setJobStatus(account.id, { jobId, to }));
  if (!message) refresh();
  return message;
}

/** "Report this job" on Departures. */
export async function reportJobAction(jobId: string, reason: ReportReason, note: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return words(await reportJob(account.id, { jobId, reason, note: note.trim() || undefined }));
}
