"use server";

import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { openNotifications } from "@/lib/notifications/store";
import type { NotificationsOpened } from "@/lib/notifications/types";

/*
 * The bell's panel (docs/plans/notifications-plan.md). Opening it reads the signed-in person's newest notifications and
 * marks them all read. No input: the session says whose they are. There is no polling; the count is read with each page.
 */

export async function openNotificationsAction(): Promise<NotificationsOpened> {
  const account = await currentAccount();
  if (!account) return { error: "Please sign in again." };
  try {
    const r = await openNotifications(account.id, {});
    return r.ok ? { items: r.items } : { error: "That didn't work. Please try again." };
  } catch (error) {
    logEvent("error", "notifications_open_failed", errorFields(error));
    return { error: "Notifications can't be shown just now. Please try again." };
  }
}
