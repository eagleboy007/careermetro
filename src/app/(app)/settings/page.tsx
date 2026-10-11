import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { exampleSettings } from "@/components/settings/fixtures";
import { SettingsView, type SettingsData } from "@/components/settings/settings-view";
import { splitName } from "@/lib/account/name";
import { currentAccount, currentIdentity } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Account settings · CareerMetro", robots: { index: false } };

async function SettingsScreen() {
  await connection();
  const [account, identity] = await Promise.all([currentAccount(), currentIdentity()]);
  // An account saved before first and last name were asked for starts from its full name.
  const names = account?.firstName ? { first: account.firstName, last: account.lastName ?? "" } : splitName(account?.name);
  const data: SettingsData = account
    ? { firstName: names.first, lastName: names.last, email: account.email, emailVerified: identity?.emailVerified ?? false, method: identity?.method ?? null, editable: true }
    : exampleSettings;
  return <SettingsView data={data} />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SettingsScreen />
    </Suspense>
  );
}
