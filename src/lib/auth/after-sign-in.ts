import "server-only";
import { claimAnonymousResumes, findAccount, touchLastSeen } from "@/lib/account/store";
import { syncCurrentGoals } from "@/lib/goals/store";
import { readSessionId } from "@/lib/session";
import { currentIdentity } from "./server";

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
  if (!account) return `/sign-up/finish?next=${encodeURIComponent(next)}`;
  const sessionId = await readSessionId();
  const claim = sessionId ? await claimAnonymousResumes(account.id, sessionId) : null;
  if (claim?.claimed) await syncCurrentGoals(account.id);
  await touchLastSeen(account.id);
  return claim?.refused ? withNameNotice(next) : next;
}
