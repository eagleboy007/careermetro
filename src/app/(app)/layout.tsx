import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { exampleName, exampleStreak } from "@/lib/today/fixtures";
import { signedInPreviewEnabled } from "@/lib/preview";

/** Signed-in screens. Until sign-in exists they run on example data, behind the preview flag. */
async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  if (!signedInPreviewEnabled()) notFound();
  const user = { name: `${exampleName} Nair`, initials: "PN", streakDays: exampleStreak.days, todayCounted: false, showStreak: true };
  return <AppShell user={user}>{children}</AppShell>;
}

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
