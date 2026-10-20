import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { exampleSettings } from "@/components/settings/fixtures";
import { SettingsView, type SettingsData } from "@/components/settings/settings-view";
import { splitName } from "@/lib/account/name";
import { readAccountSettings } from "@/lib/account/settings-store";
import { nameLocked } from "@/lib/account/store";
import { lakhText } from "@/lib/account/username";
import { currentAccount, currentIdentity } from "@/lib/auth/server";
import { discoveryFor } from "@/lib/corporate/find-store";
import { planFor } from "@/lib/elite/store";
import { blockedPeople, networkSettingsFor } from "@/lib/network/store";
import { DEFAULT_SETTINGS } from "@/lib/schemas";
import { switchElite, switchEliteBadge } from "../elite/actions";
import { setFindMe, unblockFromNetwork } from "../network/actions";
import { blockCompanyAction, unblockCompanyAction } from "./actions";

export const metadata: Metadata = { title: "Account settings · CareerMetro", robots: { index: false } };

const dateText = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function SettingsScreen() {
  await connection();
  const [account, identity] = await Promise.all([currentAccount(), currentIdentity()]);
  if (!account) return <SettingsView data={exampleSettings} />;
  const now = new Date();
  const [saved, discovery, network, plan, blocked] = await Promise.all([
    readAccountSettings(account.id, now),
    discoveryFor(account.id, { now }),
    networkSettingsFor(account.id),
    planFor(account.id),
    blockedPeople(account.id),
  ]);
  // An account saved before first and last name were asked for starts from its full name.
  const names = account.firstName ? { first: account.firstName, last: account.lastName ?? "" } : splitName(account.name);
  const data: SettingsData = {
    firstName: names.first,
    lastName: names.last,
    email: account.email,
    emailVerified: identity?.emailVerified ?? false,
    method: identity?.method ?? null,
    editable: true,
    nameLocked: nameLocked(account),
    draft: {
      username: saved?.username ?? "",
      headline: saved?.headline ?? "",
      city: saved?.city ?? "",
      currentPay: lakhText(saved?.pay.currentLakh ?? null),
      expectedPay: lakhText(saved?.pay.expectedLakh ?? null),
      // "Connection requests from" is one of Network's choices; the form saves it with the rest (gap list item 32).
      settings: { ...(saved?.settings ?? DEFAULT_SETTINGS), requestsFrom: network.requestsFrom },
    },
    usernameLockedUntil: saved?.usernameLockedUntil ? dateText(saved.usernameLockedUntil) : null,
    discovery,
    peopleCanFind: network.peopleCanFind,
    blockedPeople: blocked.map((p) => ({ id: p.id, name: p.name, since: dateText(p.since) })),
    plan,
  };
  return <SettingsView data={data} discoveryActions={{ block: blockCompanyAction, unblock: unblockCompanyAction }} findMe={setFindMe} unblockPerson={unblockFromNetwork} planActions={{ switchElite, switchBadge: switchEliteBadge }} />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SettingsScreen />
    </Suspense>
  );
}
