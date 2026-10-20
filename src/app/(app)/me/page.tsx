import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MePlanCard } from "@/components/elite/me-plan-card";
import { MeView } from "@/components/me/me-view";
import { readAccountSettings } from "@/lib/account/settings-store";
import { currentAccount } from "@/lib/auth/server";
import { planFor } from "@/lib/elite/store";
import { exampleMe } from "@/lib/me/fixtures";
import { publicProfile, whoSeesFor } from "@/lib/me/public";
import { jobCheckOpen } from "@/lib/me/job-email-check";
import { meFor } from "@/lib/me/store";
import { errorFields, logEvent } from "@/lib/log";
import { exampleTrends } from "@/lib/practice/fixtures";
import { practiceTrendsFor } from "@/lib/practice/store";
import { DEFAULT_SETTINGS, type PlanView } from "@/lib/schemas";
import { switchEliteBadge } from "../elite/actions";
import { checkCertificateOnCredly, confirmJobCheckCode, sendJobCheckCode } from "./actions";

export const metadata: Metadata = { title: "Your profile · CareerMetro", robots: { index: false } };

const FREE: PlanView = { elite: false, badgeShown: false, since: null };

async function MeScreen() {
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
          Preview with example data. Your own profile appears here once you sign in and add your resume.
        </p>
        <MeView me={exampleMe} others={publicProfile(exampleMe, DEFAULT_SETTINGS)} practice={exampleTrends} planCard={<MePlanCard plan={FREE} />} />
      </div>
    );
  }
  const now = new Date();
  const [me, saved, practice, plan] = await Promise.all([
    meFor(account.id, now),
    readAccountSettings(account.id, now),
    // Practice confidence is a side section: if it can't be read, the rest of the profile still shows.
    practiceTrendsFor(account.id).catch((error: unknown) => {
      logEvent("error", "practice_trend_failed", errorFields(error));
      return undefined;
    }),
    // So is the plan card: if the plan can't be read, it shows Free and the rest of the profile still shows.
    planFor(account.id).catch((error: unknown): PlanView => {
      logEvent("error", "elite_plan_failed", errorFields(error));
      return FREE;
    }),
  ]);
  const settings = saved?.settings ?? DEFAULT_SETTINGS;
  const hidden = settings.visibility === "only_me" || !saved?.username;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        {hidden
          ? "Only you can see this page. Pick a username and who can open your profile in Account settings."
          : "Your stories, interests and status come next."}
      </p>
      {me && (
        <MeView
          me={me}
          others={publicProfile(me, settings)}
          whoSees={whoSeesFor(settings, saved?.username ?? null)}
          practice={practice}
          onCheckCertificate={checkCertificateOnCredly}
          jobCheck={{ open: jobCheckOpen(), actions: { startJoin: sendJobCheckCode, finishJoin: confirmJobCheckCode } }}
          eliteBadge={plan.badgeShown}
          planCard={<MePlanCard plan={plan} onBadge={switchEliteBadge} />}
        />
      )}
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MeScreen />
    </Suspense>
  );
}
