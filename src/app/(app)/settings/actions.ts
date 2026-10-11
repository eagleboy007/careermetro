"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requestDeletion } from "@/lib/account/delete";
import { saveNames } from "@/lib/account/store";
import { hasUsableName } from "@/lib/resume/name-match";
import { currentAccount, signOut } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/session";

export type BasicsState = { error: string | null; saved: boolean };

/** Saves first and last name from Account settings. */
export async function saveBasics(_: BasicsState, formData: FormData): Promise<BasicsState> {
  const account = await currentAccount();
  if (!account) return { error: "Please sign in again to save changes.", saved: false };
  const first = String(formData.get("firstName") ?? "");
  const last = String(formData.get("lastName") ?? "");
  // The name checks a new resume is the person's own (dev/resume-name-check-plan.md), so a first name is required.
  if (!hasUsableName(first)) return { error: "Please add your first name as it appears on your resume.", saved: false };
  if (!(await saveNames(account.id, first, last))) return { error: "That didn't save. Please try again.", saved: false };
  // The avatar menu shows the name too.
  refresh();
  return { error: null, saved: true };
}

export type DeleteState = { error: string | null };

/** Deletes the account after the person typed DELETE: hidden at once, signed out, removed for good after 30 days. */
export async function deleteAccount(_: DeleteState, formData: FormData): Promise<DeleteState> {
  if (String(formData.get("confirm") ?? "").trim() !== "DELETE") return { error: "Type DELETE in capitals to confirm." };
  const account = await currentAccount();
  if (!account) return { error: "Please sign in again to delete your account." };
  await requestDeletion(account.id);
  await signOut();
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/account/deleted");
}
