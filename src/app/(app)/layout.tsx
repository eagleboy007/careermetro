import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, type ShellUser } from "@/components/app/app-shell";
import { PageLoading } from "@/components/app/page-loading";
import { displayName } from "@/lib/account/name";
import { touchLastSeen } from "@/lib/account/store";
import { rideStatsFor } from "@/lib/ride/store";
import { authConfig } from "@/lib/auth/config";
import { RESTORE_PATH, SUSPENDED_PATH } from "@/lib/auth/after-sign-in";
import { currentIdentity, signedInAccount, suspendedFor } from "@/lib/auth/server";
import { isAdmin } from "@/lib/admin/access";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { exampleThreads } from "@/lib/inbox/fixtures";
import { exampleApplications } from "@/components/corporate/fixtures";
import { arrivalsCount } from "@/lib/corporate/applications-store";
import { corporateUnread } from "@/lib/corporate/overview";
import { unreadChats } from "@/lib/inbox/store";
import { requestsWaiting } from "@/lib/network/store";
import { newCount } from "@/lib/notifications/store";
import { exampleNewCount } from "@/lib/notifications/fixtures";
import { openNotificationsAction } from "./notifications/actions";
import { eliteOn } from "@/lib/elite/store";
import { jobSearchOn } from "@/lib/job-search/store";
import { unreadCount } from "@/lib/inbox/types";
import { exampleName, exampleStreak } from "@/lib/today/fixtures";
import { signedInPreviewEnabled } from "@/lib/preview";
import { errorFields, logEvent } from "@/lib/log";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/**
 * The streak and the unread count are extras on the top bar: if one can't be read, the bar shows without it and the
 * page still loads, instead of every signed-in screen failing.
 */
async function extra<T>(name: string, read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "shell_extra_failed", { part: name, ...errorFields(error) });
    return fallback;
  }
}

/**
 * Signed-in screens, behind the preview flag until Today runs on real data. With sign-in set up, or the test sign-in on
 * a preview, the person must have an account (the proxy already sent signed-out visitors to /sign-in); otherwise the
 * screens show example data.
 */
async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  if (!signedInPreviewEnabled()) notFound();
  let user: ShellUser;
  if (authConfig() || testSignInEnabled()) {
    const account = await signedInAccount();
    if (account?.deletionRequestedAt) redirect(RESTORE_PATH);
    if (!account) redirect((await currentIdentity()) ? "/sign-up/finish" : "/sign-in");
    // Suspended after a report (FR-46): the notice instead of any signed-in page. Admins are never blocked.
    if (suspendedFor(account, await currentIdentity())) redirect(SUSPENDED_PATH);
    const [, streak, inboxUnread, companyUnread, networkRequests, elite, arrivals, searching, notificationsNew] = await Promise.all([
      extra("last_seen", touchLastSeen(account.id), undefined),
      extra("streak", rideStatsFor(account.id, new Date()).then((s) => s.streak), { days: 0, todayCounted: false }),
      extra("inbox_unread", unreadChats(account.id), 0),
      // Read from the person's live company role, so a removed role shows nothing.
      extra("corporate_unread", corporateUnread(account.id), 0),
      extra("network_requests", requestsWaiting(account.id), 0),
      // Elite (FR-50): the award mark on the avatar and "Elite · beta" in the menu.
      extra("plan", eliteOn(account.id), false),
      extra("arrivals_count", arrivalsCount(account.id), 0),
      // Job search off (handoff 6) hides the Arrivals count; if it can't be read, the count shows as before.
      extra("job_search", jobSearchOn(account.id), true),
      // The bell's dot (docs/plans/notifications-plan.md): read with each page, next to the Inbox count; no polling.
      extra("notifications_new", newCount(account.id), 0),
    ]);
    const name = displayName(account.name);
    // The streak shows once the person has ridden a day. So does the Arrivals count: like the prototype it hides with
    // no resume and on the first day, and a streak is how Today tells a returning person from those two (todayStateFor).
    // It also hides while job search is off.
    user = {
      name,
      handle: account.username,
      initials: initials(name),
      streakDays: streak.days,
      todayCounted: streak.todayCounted,
      showStreak: streak.days > 0,
      canSignOut: true,
      inboxUnread,
      corporateUnread: companyUnread,
      networkRequests,
      elite,
      arrivalsCount: streak.days > 0 && searching ? arrivals : 0,
      isAdmin: isAdmin(await currentIdentity()),
      notificationsNew,
    };
    return (
      <AppShell user={user} openNotifications={openNotificationsAction}>
        {children}
      </AppShell>
    );
  } else {
    user = {
      name: `${exampleName} Nair`,
      handle: "priya-n",
      initials: "PN",
      streakDays: exampleStreak.days,
      todayCounted: false,
      showStreak: true,
      canSignOut: false,
      inboxUnread: unreadCount(exampleThreads),
      arrivalsCount: exampleApplications.filter((a) => !a.withdrawn).length,
      notificationsNew: exampleNewCount,
    };
  }
  return <AppShell user={user}>{children}</AppShell>;
}

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={
        <AppShell user={null}>
          <PageLoading />
        </AppShell>
      }
    >
      <Shell>{children}</Shell>
    </Suspense>
  );
}
