import "server-only";
import { cache } from "react";
import { currentAccount, currentIdentity } from "@/lib/auth/server";
import { isAdmin } from "./access";

/**
 * The signed-in admin (src/lib/admin/access.ts) with their user id, or null for anyone else: signed out, not finished
 * sign-up, a deleted account, or an email not in ADMIN_EMAILS. Every admin page and server action asks this itself.
 * Once per request.
 */
export const currentAdmin = cache(async (): Promise<{ userId: string } | null> => {
  const identity = await currentIdentity();
  if (!isAdmin(identity)) return null;
  const account = await currentAccount();
  return account ? { userId: account.id } : null;
});
