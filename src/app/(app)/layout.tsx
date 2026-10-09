import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, type ShellUser } from "@/components/app/app-shell";
import { touchLastSeen } from "@/lib/account/store";
import { authConfig } from "@/lib/auth/config";
import { currentAccount, currentIdentity } from "@/lib/auth/server";
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
 * Signed-in screens, behind the preview flag until Today runs on real data. With sign-in set up, the person must have
 * an account (the proxy already sent signed-out visitors to /sign-in); without it, the screens show example data.
 */
async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  if (!signedInPreviewEnabled()) notFound();
  let user: ShellUser;
  if (authConfig()) {
    const account = await currentAccount();
    if (!account) redirect((await currentIdentity()) ? "/sign-up/finish" : "/sign-in");
    await touchLastSeen(account.id);
    const name = account.name ?? account.email.split("@")[0];
    // Streak comes from the ride tables (build step 6).
    user = { name, initials: initials(name), streakDays: 0, todayCounted: false, showStreak: false, canSignOut: true };
  } else {
    user = { name: `${exampleName} Nair`, initials: "PN", streakDays: exampleStreak.days, todayCounted: false, showStreak: true, canSignOut: false };
  }
  return <AppShell user={user}>{children}</AppShell>;
}

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
