import "server-only";
import { claimAnonymousResumes, findAccount, touchLastSeen } from "@/lib/account/store";
import { syncCurrentGoals } from "@/lib/goals/store";
import { readSessionId } from "@/lib/session";
import { currentIdentity } from "./server";

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
  if (sessionId && (await claimAnonymousResumes(account.id, sessionId)) > 0) await syncCurrentGoals(account.id);
  await touchLastSeen(account.id);
  return next;
}
