import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { DeparturesView } from "@/components/departures/departures-view";
import { PostedJobs } from "@/components/departures/posted-jobs";
import { currentAccount } from "@/lib/auth/server";
import { applyStates, criteriaStates } from "@/lib/corporate/applications-store";
import { liveJobs } from "@/lib/corporate/jobs-store";
import type { ApplyState, CriteriaView, PostedJobView } from "@/lib/corporate/types";
import { exampleApplied, exampleJobs, exampleSaved } from "@/lib/departures/fixtures";
import { errorFields, logEvent } from "@/lib/log";
import { currentAnalysis } from "@/lib/today/state";
import { applyAction, previewAction } from "../arrivals/actions";
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

/** Where the person stands on each posted job. If it can't be read, the cards ask them to sign in rather than fail. */
async function postedStates(userId: string | null, jobs: PostedJobView[]): Promise<Record<string, ApplyState>> {
  if (!jobs.length) return {};
  try {
    return await applyStates(
      userId,
      jobs.map((j) => j.id),
    );
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_apply_states_failed", errorFields(error));
    return {};
  }
}

/** Each posted job's Express apply criteria against the person's proofs. If they can't be read, the cards show names only. */
async function postedCriteria(userId: string | null, jobs: PostedJobView[]): Promise<Record<string, CriteriaView>> {
  if (!userId || !jobs.length) return {};
  try {
    return await criteriaStates(
      userId,
      jobs.map((j) => j.id),
    );
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_criteria_failed", errorFields(error));
    return {};
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
  const [states, criteria] = await Promise.all([postedStates(account?.id ?? null, posted), postedCriteria(account?.id ?? null, posted)]);
  return (
    <div className="flex flex-col gap-4">
      <PostedJobs
        jobs={posted}
        report={account ? reportJobAction : undefined}
        apply={account ? applyAction : undefined}
        preview={account ? previewAction : undefined}
        states={states}
        criteria={criteria}
      />
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
