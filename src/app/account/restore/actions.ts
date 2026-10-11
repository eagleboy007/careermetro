"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { restoreAccount } from "@/lib/account/delete";
import { signedInAccount, signOut } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/session";

/** "Restore your account": brings a deleted account back while it is within its 30 days. */
export async function restore(): Promise<void> {
  const account = await signedInAccount();
  if (!account) redirect("/sign-in");
  if (account.deletionRequestedAt && !(await restoreAccount(account.id))) redirect("/account/deleted");
  redirect("/today");
}

/** "Keep it deleted": signs out; the account goes for good when its 30 days are up. */
export async function keepDeleted(): Promise<void> {
  await signOut();
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/account/deleted");
}
