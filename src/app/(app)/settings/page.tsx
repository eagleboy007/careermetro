import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { SettingsJobSearch } from "@/components/job-search/settings-job-search";
import { exampleSettings } from "@/components/settings/fixtures";
import { SettingsView, type SettingsData } from "@/components/settings/settings-view";
import { WeeklyPreview } from "@/components/settings/weekly-preview";
import { EventsDigestSwitch } from "@/components/timetable/events-digest-switch";
import { splitName } from "@/lib/account/name";
import { readAccountSettings } from "@/lib/account/settings-store";
import { nameLocked } from "@/lib/account/store";
import { lakhText } from "@/lib/account/username";
import { currentAccount, currentIdentity } from "@/lib/auth/server";
import { discoveryFor } from "@/lib/corporate/find-store";
import { planFor } from "@/lib/elite/store";
import { jobSearchFor } from "@/lib/job-search/store";
import { showOnMapFor } from "@/lib/map/riders";
import { errorFields, logEvent } from "@/lib/log";
import { weeklyFor } from "@/lib/my-jobs/weekly-store";
import type { WeeklyView } from "@/lib/my-jobs/weekly";
import { blockedPeople, networkSettingsFor } from "@/lib/network/store";
import { indiaDay } from "@/lib/ride/days";
import { DEFAULT_SETTINGS } from "@/lib/schemas";
import { eventsDigestOn } from "@/lib/timetable/digest-store";
import { switchElite, switchEliteBadge } from "../elite/actions";
import { setFindMe, unblockFromNetwork } from "../network/actions";
import { blockCompanyAction, unblockCompanyAction } from "./actions";
import { eventsDigestAction } from "../timetable/actions";
import { saveNotice, switchJobSearch } from "./job-search-actions";
import { switchShowOnMap } from "./map-share-actions";

export const metadata: Metadata = { title: "Account settings · CareerMetro", robots: { index: false } };

/** This week's email for the preview; undefined (no preview) when it can't be read. Sends nothing. */
async function weeklyPreviewFor(userId: string, now: Date): Promise<WeeklyView | null | undefined> {
  try {
    return await weeklyFor(userId, { now });
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "settings_weekly_preview_failed", errorFields(error));
    return undefined;
  }
}

const dateText = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function SettingsScreen() {
  await connection();
  const [account, identity] = await Promise.all([currentAccount(), currentIdentity()]);
  if (!account) return <SettingsView data={exampleSettings} />;
  const now = new Date();
  const [saved, discovery, network, plan, blocked, search, week, digestOn, onMap] = await Promise.all([
    readAccountSettings(account.id, now),
    discoveryFor(account.id, { now }),
    networkSettingsFor(account.id),
    planFor(account.id),
    blockedPeople(account.id),
    jobSearchFor(account.id),
    weeklyPreviewFor(account.id, now),
    eventsDigestOn(account.id),
    showOnMapFor(account.id),
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
      openToWorkIn: saved?.openToWorkIn ?? [],
      currentPay: lakhText(saved?.pay.currentLakh ?? null),
      expectedPay: lakhText(saved?.pay.expectedLakh ?? null),
      // "Connection requests from" is one of Network's choices; the form saves it with the rest (gap list item 32).
      settings: { ...(saved?.settings ?? DEFAULT_SETTINGS), requestsFrom: network.requestsFrom },
    },
    usernameLockedUntil: saved?.usernameLockedUntil ? dateText(saved.usernameLockedUntil) : null,
    discovery,
    peopleCanFind: network.peopleCanFind,
    showOnMap: onMap,
    blockedPeople: blocked.map((p) => ({ id: p.id, name: p.name, since: dateText(p.since) })),
    plan,
  };
  return (
    <SettingsView
      data={data}
      discoveryActions={{ block: blockCompanyAction, unblock: unblockCompanyAction }}
      findMe={setFindMe}
      mapShare={switchShowOnMap}
      unblockPerson={unblockFromNetwork}
      planActions={{ switchElite, switchBadge: switchEliteBadge }}
      jobSearch={<SettingsJobSearch view={search} today={indiaDay(now)} actions={{ jobSearch: switchJobSearch, notice: saveNotice }} />}
      weekly={week === undefined ? undefined : <WeeklyPreview view={week} name={names.first || null} />}
      digest={<EventsDigestSwitch initial={digestOn} action={eventsDigestAction} />}
    />
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SettingsScreen />
    </Suspense>
  );
}
