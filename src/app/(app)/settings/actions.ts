"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requestDeletion } from "@/lib/account/delete";
import { nameLocked, saveNames } from "@/lib/account/store";
import { hasUsableName } from "@/lib/resume/name-match";
import { currentAccount, signOut } from "@/lib/auth/server";
import { SESSION_COOKIE } from "@/lib/session";

const NAME_LOCKED_MESSAGE = "Your name can't be changed here. To correct it, ask us from the Grievances page.";

export type BasicsState = { error: string | null; saved: boolean };

/** Saves first and last name from Account settings, only for an account that has no name yet. */
export async function saveBasics(_: BasicsState, formData: FormData): Promise<BasicsState> {
  const account = await currentAccount();
  if (!account) return { error: "Please sign in again to save changes.", saved: false };
  if (nameLocked(account)) return { error: NAME_LOCKED_MESSAGE, saved: false };
  const first = String(formData.get("firstName") ?? "");
  const last = String(formData.get("lastName") ?? "");
  // The name checks a new resume is the person's own (dev/resume-name-check-plan.md), so a first name is required.
  if (!hasUsableName(first)) return { error: "Please add your first name as it appears on your resume.", saved: false };
  // No row changed means a name was set meanwhile (or one we read as unusable is there): it is locked either way.
  if (!(await saveNames(account.id, first, last))) return { error: NAME_LOCKED_MESSAGE, saved: false };
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
