import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { DeparturesView } from "@/components/departures/departures-view";
import { PostedJobs } from "@/components/departures/posted-jobs";
import { mockQuestions, roleProfiles } from "@/content";
import { JobSearchGate, JobSearchPaused, JobSearchProvider, JobSearchSwitch } from "@/components/job-search/job-search";
import { currentAccount } from "@/lib/auth/server";
import { applyStates, criteriaStates } from "@/lib/corporate/applications-store";
import { liveJobs } from "@/lib/corporate/jobs-store";
import type { ApplyState, CriteriaView, PostedJobView } from "@/lib/corporate/types";
import { exampleApplied, exampleJobs, exampleSaved } from "@/lib/departures/fixtures";
import { eliteOn } from "@/lib/elite/store";
import { suggestedCanJoin } from "@/lib/job-search/rules";
import { jobSearchFor } from "@/lib/job-search/store";
import { errorFields, logEvent } from "@/lib/log";
import { prepForJobs } from "@/lib/mock/rules";
import { indiaDay } from "@/lib/ride/days";
import { DEFAULT_JOB_SEARCH } from "@/lib/schemas";
import { currentAnalysis } from "@/lib/today/state";
import { applyAction, previewAction } from "../arrivals/actions";
import { reportJobAction } from "../corporate/jobs/actions";
import { switchJobSearch } from "../settings/job-search-actions";

/** The header's words, also on the paused page while job search is off. */
const LEDE = "Roles from public company job boards and posts you paste, applied for on the company's site. Jobs posted on CareerMetro, above, take Express apply.";

export const metadata: Metadata = { title: "Departures · CareerMetro", robots: { index: false } };

/** Match's "N open jobs" link: `?role=<slug>` of one of our role profiles. Anything else shows every job. */
function roleFilter(value: string | string[] | undefined): { slug: string; title: string } | null {
  const role = typeof value === "string" ? roleProfiles.find((r) => r.slug === value) : undefined;
  return role ? { slug: role.slug, title: role.title } : null;
}

/** Open jobs from verified companies, for one role when given. If they can't be read, Departures still shows its other roles. */
async function postedJobs(roleSlug?: string): Promise<PostedJobView[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    return await liveJobs({ roleSlug });
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

/** Whether the person has Elite, for each role's interview prep. If it can't be read, the prep shows as on Free. */
async function eliteFor(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    return await eliteOn(userId);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_elite_failed", errorFields(error));
    return false;
  }
}

async function DeparturesScreen({ searchParams }: PageProps<"/departures">) {
  const params = await searchParams;
  const state = params.state;
  const role = roleFilter(params.role);
  await connection();
  const account = await currentAccount();
  // Real roles need the job-post tables (dev/departures-plan.md). Until then everyone sees example roles. The example fit
  // belongs to the example person, so a signed-in person never sees it as their own.
  const analysis = account ? await currentAnalysis(account.id) : null;
  const hasResume = account ? analysis !== null : state !== "no_resume";
  const noFit = account && hasResume ? "Your fit for each role shows here once real roles come from company job boards." : null;
  const posted = await postedJobs(role?.slug);
  const [states, criteria, elite, search] = await Promise.all([
    postedStates(account?.id ?? null, posted),
    postedCriteria(account?.id ?? null, posted),
    eliteFor(account?.id ?? null),
    account ? jobSearchFor(account.id) : DEFAULT_JOB_SEARCH,
  ]);
  // Interview prep for each role, locked on the server: on Free, only the first question's text reaches the browser.
  const prep = prepForJobs(exampleJobs, mockQuestions, roleProfiles, elite);
  // Job search off pauses Departures (handoff 6): the header with the switch and the off card only. Express apply is
  // refused on the server too.
  return (
    <JobSearchProvider initialOn={search.on} action={account ? switchJobSearch : undefined}>
      <JobSearchGate paused={<JobSearchPaused title="Departures" lede={LEDE} />}>
        <div className="flex flex-col gap-4">
          {role && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
              <span>
                {posted.length ? "Posted jobs for " : "No posted jobs for "}
                <b className="font-medium text-ink">{role.title}</b>
                {posted.length ? " only." : " right now."}
              </span>
              <Link href="/departures" className="font-medium text-ink underline underline-offset-2">
                Show every job
              </Link>
            </p>
          )}
          <PostedJobs
            jobs={posted}
            report={account ? reportJobAction : undefined}
            apply={account ? applyAction : undefined}
            preview={account ? previewAction : undefined}
            states={states}
            criteria={criteria}
            canJoin={suggestedCanJoin(search, indiaDay(new Date()))}
          />
          <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
            Example roles for now. Real roles from public company job boards, and your own saved and applied lists, come next.
          </p>
          <DeparturesView
            jobs={exampleJobs}
            hasResume={hasResume}
            noFit={noFit}
            initialSaved={account ? [] : exampleSaved}
            initialApplied={account ? [] : exampleApplied}
            // A pasted post is checked against the person's latest resume; without one the box links to the upload. The
            // signed-out example has the example person's resume, so its box is an example too and saves nothing.
            resumeId={account ? (analysis?.resumeId ?? null) : hasResume ? "example" : null}
            demo={!account}
            prep={prep}
            searchSwitch={<JobSearchSwitch />}
          />
        </div>
      </JobSearchGate>
    </JobSearchProvider>
  );
}

export default function DeparturesPage(props: PageProps<"/departures">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <DeparturesScreen {...props} />
    </Suspense>
  );
}
