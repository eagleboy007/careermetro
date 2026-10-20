import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { ArrivalsView } from "@/components/arrivals/arrivals-view";
import { exampleApplications } from "@/components/corporate/fixtures";
import { JobSearchGate, JobSearchOffCard, JobSearchPaused, JobSearchProvider, JobSearchSwitch } from "@/components/job-search/job-search";
import { NoticeCard } from "@/components/job-search/notice-card";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { closedGoalLinks } from "@/lib/arrivals/store";
import type { GoalLink } from "@/lib/arrivals/goal-link";
import { myApplications } from "@/lib/corporate/applications-store";
import { liveInvitations } from "@/lib/job-search/rules";
import { errorFields, logEvent } from "@/lib/log";
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
 * Job search on Arrivals (handoff 6): the switch, and the private notice period card. While it is off, the header and
 * the off card, plus any live interview invitation with Respond and Withdraw, so an invitation is never missed (FR-52);
 * everything else pauses. Applications already sent stay as they are, and companies can still message about them.
 */
function SearchGate({
  search,
  today,
  signedIn,
  note,
  invitations,
  children,
}: {
  search: JobSearchView;
  today: string;
  signedIn: boolean;
  note?: React.ReactNode;
  invitations: (pausedNote: React.ReactNode) => React.ReactNode | null;
  children: (top: React.ReactNode) => React.ReactNode;
}) {
  const top = (
    <div className="flex flex-col gap-3">
      {note}
      <JobSearchSwitch />
      <NoticeCard initial={{ days: search.noticeDays, resignedOn: search.resignedOn }} today={today} action={signedIn ? saveNotice : undefined} />
    </div>
  );
  const pausedNote = (
    <div className="flex flex-col gap-3">
      {note}
      <JobSearchSwitch />
      <JobSearchOffCard />
      <p className="text-[0.86rem] text-muted">Interview invitations stay here while job search is off, so you can still answer them.</p>
    </div>
  );
  return (
    <JobSearchProvider initialOn={search.on} action={signedIn ? switchJobSearch : undefined}>
      <JobSearchGate
        paused={
          invitations(pausedNote) ?? (
            <div className="mx-auto w-full max-w-[920px]">
              <JobSearchPaused eyebrow="Arrivals" title="Your applications" lede={LEDE} level={1} />
            </div>
          )
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
        invitations={(pausedNote) => {
          const live = liveInvitations(exampleApplications, EXAMPLE_TODAY);
          return live.length ? <ArrivalsView applications={live} today={EXAMPLE_TODAY} note={pausedNote} invitationsOnly /> : null;
        }}
      >
        {(top) => <ArrivalsView applications={exampleApplications} today={EXAMPLE_TODAY} note={top} />}
      </SearchGate>
    );
  }
  const now = new Date();
  const [applications, search] = await Promise.all([myApplications(account.id, { now }), jobSearchFor(account.id)]);
  const today = indiaDay(now);
  const live = liveInvitations(applications, today);
  // The closed-role goal line is extra: if the line can't be read, Arrivals shows without it (error fields only).
  let goalLinks: Record<string, GoalLink> = {};
  if (search.on) {
    try {
      goalLinks = await closedGoalLinks(account.id, applications, now);
    } catch (error) {
      unstable_rethrow(error);
      logEvent("error", "arrivals_goal_links_failed", errorFields(error));
    }
  }
  return (
    <SearchGate
      search={search}
      today={today}
      signedIn
      invitations={(pausedNote) =>
        live.length ? (
          <ArrivalsView
            applications={live}
            today={today}
            withdraw={withdrawAction}
            actions={{ respond: respondAction, stopSharing: stopSharingAction }}
            note={pausedNote}
            invitationsOnly
          />
        ) : null
      }
    >
      {(top) => (
        <ArrivalsView
          applications={applications}
          today={today}
          withdraw={withdrawAction}
          actions={{ respond: respondAction, stopSharing: stopSharingAction }}
          note={top}
          goalLinks={goalLinks}
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
