"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { DESTINATION_MESSAGES, makeDestination } from "@/lib/gaps/choose";
import { errorFields, logEvent } from "@/lib/log";

/**
 * "Make this my destination" on a role's Gaps page and "Switch back" on the Map (docs/plans/change-destination-plan.md):
 * `{ analysisId }` of one of the signed-in person's own analyses. The store checks it with Zod, counts the try against
 * the day's limit and writes only the person's own analysis, never the sample's. Answers null once done, else the words
 * to show. Nothing is logged but a failure's event name.
 */
export async function chooseDestination(input: unknown): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return "Please sign in again.";
  try {
    const result = await makeDestination(account.id, input);
    if (!result.ok) return DESTINATION_MESSAGES[result.error];
  } catch (error) {
    logEvent("error", "destination_change_failed", errorFields(error));
    return "That didn't work. Please try again.";
  }
  // Today, Your goals, the Map and the Gaps page follow the new destination.
  refresh();
  return null;
}
