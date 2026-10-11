import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, type ShellUser } from "@/components/app/app-shell";
import { PageLoading } from "@/components/app/page-loading";
import { displayName } from "@/lib/account/name";
import { touchLastSeen } from "@/lib/account/store";
import { rideStatsFor } from "@/lib/ride/store";
import { authConfig } from "@/lib/auth/config";
import { RESTORE_PATH } from "@/lib/auth/after-sign-in";
import { currentIdentity, signedInAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { exampleThreads } from "@/lib/inbox/fixtures";
import { unreadChats } from "@/lib/inbox/store";
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
    const [, streak, inboxUnread] = await Promise.all([
      extra("last_seen", touchLastSeen(account.id), undefined),
      extra("streak", rideStatsFor(account.id, new Date()).then((s) => s.streak), { days: 0, todayCounted: false }),
      extra("inbox_unread", unreadChats(account.id), 0),
    ]);
    const name = displayName(account.name);
    // The streak shows once the person has ridden a day.
    user = {
      name,
      initials: initials(name),
      streakDays: streak.days,
      todayCounted: streak.todayCounted,
      showStreak: streak.days > 0,
      canSignOut: true,
      inboxUnread,
    };
  } else {
    user = { name: `${exampleName} Nair`, initials: "PN", streakDays: exampleStreak.days, todayCounted: false, showStreak: true, canSignOut: false, inboxUnread: unreadCount(exampleThreads) };
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
