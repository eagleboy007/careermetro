import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { DeparturesView } from "@/components/departures/departures-view";
import { PostedJobs } from "@/components/departures/posted-jobs";
import { currentAccount } from "@/lib/auth/server";
import { liveJobs } from "@/lib/corporate/jobs-store";
import type { PostedJobView } from "@/lib/corporate/types";
import { exampleApplied, exampleJobs, exampleSaved } from "@/lib/departures/fixtures";
import { errorFields, logEvent } from "@/lib/log";
import { currentAnalysis } from "@/lib/today/state";
import { reportJobAction } from "../corporate/jobs/actions";

export const metadata: Metadata = { title: "Departures · CareerMetro", robots: { index: false } };

/** Open jobs from verified companies. If they can't be read, Departures still shows its other roles. */
async function postedJobs(): Promise<PostedJobView[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    return await liveJobs();
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_posted_jobs_failed", errorFields(error));
    return [];
  }
}

async function DeparturesScreen({ searchParams }: PageProps<"/departures">) {
  const state = (await searchParams).state;
  await connection();
  const account = await currentAccount();
  // Real roles need the job-post tables (dev/departures-plan.md). Until then everyone sees example roles. The example fit
  // belongs to the example person, so a signed-in person never sees it as their own.
  const hasResume = account ? (await currentAnalysis(account.id)) !== null : state !== "no_resume";
  const noFit = account && hasResume ? "Your fit for each role shows here once real roles come from company job boards." : null;
  const posted = await postedJobs();
  return (
    <div className="flex flex-col gap-4">
      <PostedJobs jobs={posted} report={account ? reportJobAction : undefined} />
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        Example roles for now. Real roles from public company job boards, and your own saved and applied lists, come next.
      </p>
      <DeparturesView jobs={exampleJobs} hasResume={hasResume} noFit={noFit} initialSaved={account ? [] : exampleSaved} initialApplied={account ? [] : exampleApplied} />
    </div>
  );
}

export default function DeparturesPage(props: PageProps<"/departures">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <DeparturesScreen {...props} />
    </Suspense>
  );
}
