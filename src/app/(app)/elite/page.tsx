import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { EliteView } from "@/components/elite/elite-view";
import { roleProfiles } from "@/content";
import { currentAccount } from "@/lib/auth/server";
import { currentAnalysis } from "@/lib/gaps/current";
import { planFor } from "@/lib/elite/store";
import { errorFields, logEvent } from "@/lib/log";
import { exampleRole } from "@/lib/today/fixtures";
import type { PlanView } from "@/lib/schemas";
import { switchElite } from "./actions";

export const metadata: Metadata = { title: "Elite · CareerMetro", robots: { index: false } };

const FREE: PlanView = { elite: false, badgeShown: false, since: null };

/**
 * Elite, free in the beta (FR-50, handoff 12l). Signed in only: the signed-in layout and the proxy send everyone else
 * away, and with no sign-in on this deployment the page shows Free and changes nothing. No billing anywhere.
 */
async function EliteScreen() {
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Preview with example data. Nothing you press here is saved.</p>
        <EliteView plan={FREE} roleTitle={exampleRole} />
      </div>
    );
  }
  let plan: PlanView;
  let roleTitle: string | null = null;
  try {
    const [found, analysis] = await Promise.all([planFor(account.id), currentAnalysis(account.id).catch(() => null)]);
    plan = found;
    // The target role from the person's current gap check, under the Free and Elite heading; the page shows without it
    // if it can't be read.
    const slug = analysis?.result.roleSlug;
    roleTitle = slug ? (roleProfiles.find((r) => r.slug === slug)?.title ?? null) : null;
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "elite_plan_failed", errorFields(error));
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t load your plan just now. Please reload the page in a minute.
      </p>
    );
  }
  return <EliteView plan={plan} roleTitle={roleTitle} onSwitch={switchElite} />;
}

export default function ElitePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <EliteScreen />
    </Suspense>
  );
}
