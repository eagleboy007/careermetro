import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { ArrivalsView } from "@/components/arrivals/arrivals-view";
import { exampleApplications } from "@/components/corporate/fixtures";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { myApplications } from "@/lib/corporate/applications-store";
import { indiaDay } from "@/lib/ride/days";
import { respondAction, stopSharingAction, withdrawAction } from "./actions";

/** The example's interviews are dated around this day, so its Next up and strip read as they would. */
const EXAMPLE_TODAY = "2026-10-12";

export const metadata: Metadata = { title: "Arrivals · CareerMetro", robots: { index: false } };

/**
 * Arrivals (handoff section 9; dev/corporate-plan.md build step 4): the signed-in person's applications on CareerMetro
 * and every step each company took, read from the application events. Without accounts (the example preview) it shows
 * example applications where nothing changes.
 */
async function Arrivals() {
  await connection();
  const accounts = !!authConfig() || testSignInEnabled();
  const account = accounts ? await currentAccount() : null;
  if (!account) {
    return (
      <ArrivalsView
        applications={exampleApplications}
        today={EXAMPLE_TODAY}
        note={<p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Example applications. Nothing you do here is saved.</p>}
      />
    );
  }
  const now = new Date();
  return (
    <ArrivalsView
      applications={await myApplications(account.id, { now })}
      today={indiaDay(now)}
      withdraw={withdrawAction}
      actions={{ respond: respondAction, stopSharing: stopSharingAction }}
    />
  );
}

export default function ArrivalsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Arrivals />
    </Suspense>
  );
}
