"use server";

import { currentAccount } from "@/lib/auth/server";
import { LIBRARY_MESSAGES, reportResource, setLibraryMark, suggestResource, type LibraryResult } from "@/lib/library/store";
import { errorFields, logEvent } from "@/lib/log";

/*
 * The Library's actions (docs/plans/library-part-2-plan.md): Save, "I finished this", Add to my rides, Report a broken
 * link and Suggest a free resource. Each checks the account itself; the store checks the input with Zod, scopes every
 * write to that account and counts it against its daily limit. The screen already shows the change, so nothing
 * refreshes here. Nothing logs the link, the title or the mark: event names and error codes only.
 */

/** null when it worked, or the words to show; `resourceId` names the catalog item a suggested link already is. */
export type LibraryActionResult = { error: string | null; resourceId?: string | null };

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

async function run(name: string, change: (userId: string) => Promise<LibraryResult>): Promise<LibraryActionResult> {
  const account = await currentAccount();
  if (!account) return { error: SIGN_IN };
  try {
    const result = await change(account.id);
    return result.ok ? { error: null } : { error: LIBRARY_MESSAGES[result.error], resourceId: result.resourceId ?? null };
  } catch (error) {
    logEvent("error", name, errorFields(error));
    return { error: FAILED };
  }
}

/** The bookmark ("saved"), "I finished this" ("finished") or Add to my rides ("onRide"), on or off. */
export async function libraryMarkAction(resourceId: string, mark: string, on: boolean): Promise<LibraryActionResult> {
  return run("library_mark_failed", (userId) => setLibraryMark(userId, { resourceId, mark, on }));
}

/** "Report a broken link" with one of the fixed reasons. */
export async function reportResourceAction(resourceId: string, reason: string): Promise<LibraryActionResult> {
  return run("library_report_failed", (userId) => reportResource(userId, { resourceId, reason }));
}

/** "Suggest a free resource": the pasted link and the goal's skill id, or null for Other. */
export async function suggestResourceAction(url: string, skillId: string | null): Promise<LibraryActionResult> {
  return run("library_suggest_failed", (userId) => suggestResource(userId, { url, skillId }));
}
