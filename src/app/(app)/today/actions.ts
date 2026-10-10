"use server";

import { currentAccount } from "@/lib/auth/server";
import { tickTask } from "@/lib/ride/store";

/** Saves a tick or untick on one of the signed-in person's ride tasks for today. Example mode has nothing to save. */
export async function tickRideTask(taskId: string, on: boolean): Promise<boolean> {
  if (typeof taskId !== "string" || typeof on !== "boolean") return false;
  const account = await currentAccount();
  if (!account) return false;
  return tickTask(account.id, taskId, on, new Date());
}
