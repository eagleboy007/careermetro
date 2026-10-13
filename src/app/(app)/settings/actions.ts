"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requestDeletion } from "@/lib/account/delete";
import { checkUsername, saveAccountSettings, type UsernameCheck } from "@/lib/account/settings-store";
import { blockCompany, unblockCompany } from "@/lib/corporate/find-store";
import { nameLocked, saveNames } from "@/lib/account/store";
import { settingsErrors, settingsInput, type SettingsField } from "@/lib/schemas";
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

export type SettingsState = { errors: Partial<Record<SettingsField, string>>; saved: boolean };

/**
 * Saves username, headline, pay, privacy and notification choices from Account settings in one go (part 2,
 * dev/account-settings-plan.md). The payload is what the form holds; it is checked here, and nothing in it is logged.
 */
export async function saveSettings(_: SettingsState, payload: unknown): Promise<SettingsState> {
  const account = await currentAccount();
  if (!account) return { errors: { settings: "Please sign in again to save changes." }, saved: false };
  const parsed = settingsInput.safeParse(payload);
  if (!parsed.success) return { errors: settingsErrors(parsed.error), saved: false };
  const result = await saveAccountSettings(account.id, parsed.data, new Date());
  if (!result.ok) return { errors: result.errors, saved: false };
  // The profile and its link read these too.
  refresh();
  return { errors: {}, saved: true };
}

/** "Is this username free?" while the person types. A server action, so the name never goes into a URL. */
export async function checkUsernameAction(raw: unknown): Promise<UsernameCheck> {
  const account = await currentAccount();
  if (!account || typeof raw !== "string") return { state: "limited" };
  return checkUsername(account.id, raw, new Date());
}

const BLOCK_FAILED = "That didn't work. Please refresh the page and try again.";

/** Blocks a company from Settings > Privacy (pending item 19). Silent: the company is not told. */
export async function blockCompanyAction(orgId: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return "Please sign in again.";
  if (!(await blockCompany(account.id, { orgId }))) return BLOCK_FAILED;
  refresh();
  return null;
}

/** Lifts a company block from Settings > Privacy. */
export async function unblockCompanyAction(orgId: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return "Please sign in again.";
  if (!(await unblockCompany(account.id, { orgId }))) return BLOCK_FAILED;
  refresh();
  return null;
}
