import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SuspendedNotice } from "@/components/account/suspended-notice";
import { SiteHeader } from "@/components/site/site-header";
import { currentIdentity, signedInAccount, suspendedFor } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Account suspended · CareerMetro", robots: { index: false } };

/**
 * Where the signed-in layout and the sign-in flow send someone whose account an admin suspended after a report
 * (FR-46). Anyone else goes on: signed out to sign in, an account that isn't suspended (or an admin's) to Today.
 */
async function Notice() {
  await connection();
  const account = await signedInAccount();
  if (!account) redirect("/sign-in?next=/account/suspended");
  if (!suspendedFor(account, await currentIdentity())) redirect("/today");
  return <SuspendedNotice reason={account.suspendedReason} />;
}

export default function SuspendedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <h1 className="text-4xl font-semibold leading-[1.05]">Your account is suspended</h1>
        <Suspense>
          <Notice />
        </Suspense>
      </div>
    </main>
  );
}
