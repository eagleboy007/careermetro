import "server-only";
import { claimAnonymousResumes, findAccount, touchLastSeen } from "@/lib/account/store";
import { syncCurrentGoals } from "@/lib/goals/store";
import { hasUsableName } from "@/lib/resume/name-match";
import { readSessionId } from "@/lib/session";
import { currentIdentity, suspendedFor } from "./server";

/** Where a person whose account is waiting to be deleted goes after signing in. */
export const RESTORE_PATH = "/account/restore";

/** Where a person whose account an admin suspended after a report goes instead of any signed-in page (FR-46). */
export const SUSPENDED_PATH = "/account/suspended";

/** The query flag that makes Today say a resume was left out of the account because it shows another name. */
export const NAME_NOTICE = "resume-name";

/** `next` with the name notice added, keeping any query it already has. */
export function withNameNotice(next: string): string {
  return `${next}${next.includes("?") ? "&" : "?"}notice=${NAME_NOTICE}`;
}

/**
 * Where to go right after a sign-in. A new person finishes sign-up first; someone with an account gets this
 * browser's anonymous analysis moved to them (FR-2) and goes on to `next`.
 */
export async function afterSignIn(next: string): Promise<string> {
  const identity = await currentIdentity();
  if (!identity) return `/sign-in?next=${encodeURIComponent(next)}`;
  const account = await findAccount(identity.subject);
  // A deleted account claims nothing; the person chooses to restore it or keep it deleted.
  if (account?.deletionRequestedAt) return RESTORE_PATH;
  // A suspended account claims nothing either; it sees only the notice until the suspension is lifted.
  if (suspendedFor(account, identity)) return SUSPENDED_PATH;
  // No account yet, or one without a name to check resumes against: the finish step asks for it first.
  if (!account || !hasUsableName(account.name)) return `/sign-up/finish?next=${encodeURIComponent(next)}`;
  const sessionId = await readSessionId();
  const claim = sessionId ? await claimAnonymousResumes(account.id, sessionId) : null;
  if (claim?.claimed) await syncCurrentGoals(account.id);
  await touchLastSeen(account.id);
  return claim?.refused ? withNameNotice(next) : next;
}
