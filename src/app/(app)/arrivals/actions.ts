"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { APPLICATION_ERROR_TEXT, applyToJob, withdrawApplication, type ApplicationResult } from "@/lib/corporate/applications-store";
import type { CanJoin } from "@/lib/corporate/types";

/*
 * The candidate's side of applications (dev/corporate-plan.md build step 4): apply from Departures with the consent
 * tick, and withdraw from Arrivals. The store validates with Zod and checks the job is open at a verified company.
 * Nothing here logs input.
 */

const SIGN_IN = "Please sign in again.";
const words = (r: ApplicationResult): string | null => (r.ok ? null : (r.message ?? APPLICATION_ERROR_TEXT[r.error]));

/** Apply to a job posted on CareerMetro. Departures reloads to show it as applied. */
export async function applyAction(jobId: string, canJoin: CanJoin, consent: boolean): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await applyToJob(account.id, { jobId, canJoin, consent }));
  if (!message) refresh();
  return message;
}

/** Withdraw an application from Arrivals. */
export async function withdrawAction(applicationId: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await withdrawApplication(account.id, { applicationId }));
  if (!message) refresh();
  return message;
}
