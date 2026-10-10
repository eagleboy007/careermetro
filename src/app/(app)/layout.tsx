import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, type ShellUser } from "@/components/app/app-shell";
import { PageLoading } from "@/components/app/page-loading";
import { touchLastSeen } from "@/lib/account/store";
import { rideStatsFor } from "@/lib/ride/store";
import { authConfig } from "@/lib/auth/config";
import { currentAccount, currentIdentity } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { exampleName, exampleStreak } from "@/lib/today/fixtures";
import { signedInPreviewEnabled } from "@/lib/preview";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

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
    const account = await currentAccount();
    if (!account) redirect((await currentIdentity()) ? "/sign-up/finish" : "/sign-in");
    const [, { streak }] = await Promise.all([touchLastSeen(account.id), rideStatsFor(account.id, new Date())]);
    const name = account.name ?? account.email.split("@")[0];
    // The streak shows once the person has ridden a day.
    user = {
      name,
      initials: initials(name),
      streakDays: streak.days,
      todayCounted: streak.todayCounted,
      showStreak: streak.days > 0,
      canSignOut: true,
    };
  } else {
    user = { name: `${exampleName} Nair`, initials: "PN", streakDays: exampleStreak.days, todayCounted: false, showStreak: true, canSignOut: false };
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
