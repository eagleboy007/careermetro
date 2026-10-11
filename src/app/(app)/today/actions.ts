"use server";

import { refresh } from "next/cache";
import { setWeeklyHours } from "@/lib/account/store";
import { currentAccount } from "@/lib/auth/server";
import { tickTask } from "@/lib/ride/store";

/** Saves a tick or untick on one of the signed-in person's ride tasks for today. Example mode has nothing to save. */
export async function tickRideTask(taskId: string, on: boolean): Promise<boolean> {
  if (typeof taskId !== "string" || typeof on !== "boolean") return false;
  const account = await currentAccount();
  if (!account) return false;
  const saved = await tickTask(account.id, taskId, on, new Date());
  // The header's streak chip reads ride days too, so the page refreshes. refresh() re-renders only this person's view;
  // revalidatePath("/", "layout") used to throw away every cached page on the site, and static pages such as
  // /roles/[slug] then failed to rebuild on the next visit (500, NEXT_STATIC_GEN_BAILOUT).
  if (saved) refresh();
  return saved;
}

/** Saves the hours a week the signed-in person picked on Today. The Path page opens at these hours. */
export async function saveWeeklyHours(hours: number): Promise<boolean> {
  if (typeof hours !== "number") return false;
  const account = await currentAccount();
  if (!account) return false;
  return setWeeklyHours(account.id, hours);
}
