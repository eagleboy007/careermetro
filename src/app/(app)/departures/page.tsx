import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { DeparturesView } from "@/components/departures/departures-view";
import { DEPARTURES_LEDE } from "@/lib/departures/filter";
import { PostedJobs } from "@/components/departures/posted-jobs";
import { mockQuestions, roleProfiles } from "@/content";
import { JobSearchGate, JobSearchPaused, JobSearchProvider, JobSearchSwitch } from "@/components/job-search/job-search";
import { currentAccount } from "@/lib/auth/server";
import { applyStates, criteriaStates } from "@/lib/corporate/applications-store";
import { liveJobs } from "@/lib/corporate/jobs-store";
import type { ApplyState, CriteriaView, PostedJobView } from "@/lib/corporate/types";
import { postView, updatedWords, type FitContext } from "@/lib/departures/fit";
import { exampleApplied, exampleJobs, exampleSaved } from "@/lib/departures/fixtures";
import { departuresBoard, fitContextFor, type DeparturesBoard } from "@/lib/departures/store";
import { suggestedCanJoin } from "@/lib/job-search/rules";
import { openToWorkInFor } from "@/lib/job-search/store";
import { eliteOnRequest, jobSearchForRequest } from "@/lib/request-reads";
import { errorFields, logEvent } from "@/lib/log";
import { prepForJobs } from "@/lib/mock/rules";
import { indiaDay } from "@/lib/ride/days";
import { DEFAULT_JOB_SEARCH } from "@/lib/schemas";
import { currentAnalysis, type CurrentAnalysis } from "@/lib/gaps/current";
import { applyAction, previewAction } from "../arrivals/actions";
import { saveDepartureAction, stageDepartureAction } from "./actions";
import { reportJobAction } from "../corporate/jobs/actions";
import { switchJobSearch } from "../settings/job-search-actions";

const DEPARTURE_ACTIONS = { save: saveDepartureAction, stage: stageDepartureAction };

export const metadata: Metadata = { title: "Departures · CareerMetro", robots: { index: false } };

/** Match's "N open jobs" link: `?role=<slug>` of one of our role profiles. Anything else shows every job. */
function roleFilter(value: string | string[] | undefined): { slug: string; title: string } | null {
  const role = typeof value === "string" ? roleProfiles.find((r) => r.slug === value) : undefined;
  return role ? { slug: role.slug, title: role.title } : null;
}

/**
 * Open jobs from verified companies, for one role when given. Null when they can't be read, so the page claims nothing
 * about them; Departures still shows its other roles.
 */
async function postedJobs(roleSlug?: string): Promise<PostedJobView[] | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    return await liveJobs({ roleSlug });
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_posted_jobs_failed", errorFields(error));
    return null;
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
    return await eliteOnRequest(userId);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_elite_failed", errorFields(error));
    return false;
  }
}

/** "Open to work in" from Settings (FR-55). If it can't be read, Departures opens on every city as before. */
async function placesFor(userId: string | null): Promise<string[]> {
  if (!userId) return [];
  try {
    return await openToWorkInFor(userId);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_places_failed", errorFields(error));
    return [];
  }
}

/** The feed's roles and the person's own lists. If they can't be read, Departures shows its other roles and says nothing is listed yet. */
async function liveBoard(userId: string, roleSlug: string | null): Promise<DeparturesBoard> {
  try {
    return await departuresBoard(userId, { roleSlug });
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_board_failed", errorFields(error));
    return { posts: [], saved: [], applied: [], updatedAt: null };
  }
}

/**
 * What fit is read against: null when the resume isn't confirmed yet, "failed" when it can't be read (the rows then
 * show without fit rather than fail).
 */
async function fitFor(userId: string, analysis: CurrentAnalysis): Promise<FitContext | null | "failed"> {
  try {
    return await fitContextFor(userId, undefined, analysis);
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "departures_fit_failed", errorFields(error));
    return "failed";
  }
}

/** Why a signed-in person with a resume sees no fit, or null when fit shows. */
function noFitWords(fit: FitContext | null | "failed"): string | null {
  if (fit === "failed") return "Your fit can't be read right now. Reload the page to try again.";
  if (fit === null) return "Confirm your resume's skills to see your fit for each role.";
  return null;
}

async function DeparturesScreen({ searchParams }: PageProps<"/departures">) {
  const params = await searchParams;
  const state = params.state;
  const role = roleFilter(params.role);
  await connection();
  const account = await currentAccount();
  // Signed in, the roles are the daily feed's (docs/plans/departures-live-plan.md), with fit read on the server against
  // the person's confirmed profile, goals and proof. Signed out, the example roles and the example person's fit.
  // Every read starts at once (docs/plans/perf-pass.md): fit waits only for the analysis, and the posted jobs' states
  // and criteria only for the posted jobs, instead of the whole page waiting for each in turn.
  const analysisRead: Promise<CurrentAnalysis | null> = account ? currentAnalysis(account.id) : Promise.resolve(null);
  const postedRead = postedJobs(role?.slug);
  const [analysis, read, board, fit, states, criteria, elite, search, places] = await Promise.all([
    analysisRead,
    postedRead,
    account ? liveBoard(account.id, role?.slug ?? null) : null,
    analysisRead.then((a) => (account && a ? fitFor(account.id, a) : null)),
    postedRead.then((jobs) => postedStates(account?.id ?? null, jobs ?? [])),
    postedRead.then((jobs) => postedCriteria(account?.id ?? null, jobs ?? [])),
    eliteFor(account?.id ?? null),
    account ? jobSearchForRequest(account.id) : DEFAULT_JOB_SEARCH,
    placesFor(account?.id ?? null),
  ]);
  const posted = read ?? [];
  const now = new Date();
  const jobs = board ? board.posts.map((p) => postView(p, fit === "failed" ? null : fit, now)) : exampleJobs;
  // A resume on file is enough to say so; a fit that can't be shown gets its own reason, not "add your resume".
  const hasResume = account ? analysis !== null : state !== "no_resume";
  const noFit = account && analysis ? noFitWords(fit) : account ? "Add your resume to see your fit for each role." : null;
  // Interview prep for each role, locked on the server: on Free, only the first question's text reaches the browser.
  const prep = prepForJobs(jobs, mockQuestions, roleProfiles, elite);
  // Job search off pauses Departures (handoff 6): the header with the switch and the off card only. Express apply is
  // refused on the server too.
  return (
    <JobSearchProvider initialOn={search.on} action={account ? switchJobSearch : undefined}>
      <JobSearchGate paused={<JobSearchPaused title="Departures" lede={DEPARTURES_LEDE} />}>
        <div className="flex flex-col gap-4">
          {role && read && (
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
          {!account && (
            <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
              Example roles and an example person&apos;s fit. Signed in, you see roles from public company job boards and your own saved and applied lists.
            </p>
          )}
          <DeparturesView
            jobs={jobs}
            hasResume={hasResume}
            noFit={noFit}
            initialSaved={board ? board.saved : exampleSaved}
            initialApplied={board ? board.applied : exampleApplied}
            updated={board ? updatedWords(board.updatedAt, now) : null}
            actions={account ? DEPARTURE_ACTIONS : undefined}
            // A pasted post is checked against the person's latest resume; without one the box links to the upload. The
            // signed-out example has the example person's resume, so its box is an example too and saves nothing.
            resumeId={account ? (analysis?.resumeId ?? null) : hasResume ? "example" : null}
            demo={!account}
            prep={prep}
            places={places}
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
