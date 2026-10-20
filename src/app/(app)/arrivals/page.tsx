import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { ArrivalsView } from "@/components/arrivals/arrivals-view";
import { exampleApplications } from "@/components/corporate/fixtures";
import { JobSearchGate, JobSearchPaused, JobSearchProvider, JobSearchSwitch } from "@/components/job-search/job-search";
import { NoticeCard } from "@/components/job-search/notice-card";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { myApplications } from "@/lib/corporate/applications-store";
import { jobSearchFor } from "@/lib/job-search/store";
import { indiaDay } from "@/lib/ride/days";
import { DEFAULT_JOB_SEARCH, type JobSearchView } from "@/lib/schemas";
import { saveNotice, switchJobSearch } from "../settings/job-search-actions";
import { respondAction, stopSharingAction, withdrawAction } from "./actions";

/** The example's interviews are dated around this day, so its Next up and strip read as they would. */
const EXAMPLE_TODAY = "2026-10-12";

export const metadata: Metadata = { title: "Arrivals · CareerMetro", robots: { index: false } };

const LEDE = "Jobs you applied to on CareerMetro, and every step each company took. Companies never see your goals, path or other applications.";

/**
 * Job search on Arrivals (handoff 6): the switch, and the private notice period card; while it is off, the header
 * and the off card only. Applications already sent stay as they are, and companies can still message about them.
 */
function SearchGate({ search, today, signedIn, note, children }: { search: JobSearchView; today: string; signedIn: boolean; note?: React.ReactNode; children: (top: React.ReactNode) => React.ReactNode }) {
  const top = (
    <div className="flex flex-col gap-3">
      {note}
      <JobSearchSwitch />
      <NoticeCard initial={{ days: search.noticeDays, resignedOn: search.resignedOn }} today={today} action={signedIn ? saveNotice : undefined} />
    </div>
  );
  return (
    <JobSearchProvider initialOn={search.on} action={signedIn ? switchJobSearch : undefined}>
      <JobSearchGate
        paused={
          <div className="mx-auto w-full max-w-[920px]">
            <JobSearchPaused eyebrow="Arrivals" title="Your applications" lede={LEDE} level={1} />
          </div>
        }
      >
        {children(top)}
      </JobSearchGate>
    </JobSearchProvider>
  );
}

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
      <SearchGate
        search={DEFAULT_JOB_SEARCH}
        today={EXAMPLE_TODAY}
        signedIn={false}
        note={<p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">Example applications. Nothing you do here is saved.</p>}
      >
        {(top) => <ArrivalsView applications={exampleApplications} today={EXAMPLE_TODAY} note={top} />}
      </SearchGate>
    );
  }
  const now = new Date();
  const [applications, search] = await Promise.all([myApplications(account.id, { now }), jobSearchFor(account.id)]);
  const today = indiaDay(now);
  return (
    <SearchGate search={search} today={today} signedIn>
      {(top) => (
        <ArrivalsView
          applications={applications}
          today={today}
          withdraw={withdrawAction}
          actions={{ respond: respondAction, stopSharing: stopSharingAction }}
          note={top}
        />
      )}
    </SearchGate>
  );
}

export default function ArrivalsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Arrivals />
    </Suspense>
  );
}
