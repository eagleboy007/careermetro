import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { JobSearchProvider } from "@/components/job-search/job-search";
import { LocalTestNotice } from "@/components/resume/local-test-notice";
import { UploadForm } from "@/components/resume/upload-form";
import { SampleLineNote } from "@/components/ui/sample-tag";
import { TodayView, type TodayData } from "@/components/today/today-preview";
import { firstName } from "@/lib/account/name";
import { NAME_NOTICE } from "@/lib/auth/after-sign-in";
import { currentAccount } from "@/lib/auth/server";
import { NAME_MISMATCH_MESSAGE } from "@/lib/resume/name-match";
import { isSampleResumeId } from "@/lib/resume/sample";
import { USER_STATES, type Departure, type EventTeaser, type NextInterviewView, type OnYourLine, type UserState } from "@/lib/schemas";
import { jobSearchForRequest } from "@/lib/request-reads";
import { errorFields, logEvent } from "@/lib/log";
import { rideWithSignal, withSignalTask } from "@/lib/ride/build";
import { greetingAt } from "@/lib/today/board";
import { departuresBoard } from "@/lib/departures/store";
import { jobPrep, nextInterview } from "@/lib/my-jobs/store";
import { daysUntil, leadSkills } from "@/lib/my-jobs/view";
import { onYourLineFor, todayBoardFor } from "@/lib/today/live";
import { timetableTeaserFor } from "@/lib/timetable/store";
import { currentAnalysis, todayStateFor } from "@/lib/today/state";
import { switchJobSearch } from "../settings/job-search-actions";
import { addCertificate, answerSignalCheck, chooseTrack, saveWeeklyHours, tickRideTask } from "./actions";
import {
  exampleDepartures,
  exampleEvents,
  exampleFirstTally,
  exampleFirstTasks,
  exampleGoals,
  exampleName,
  exampleNextInterview,
  exampleOnYourLine,
  exampleRide,
  exampleSignalCheck,
  exampleRole,
  exampleWeek,
} from "@/lib/today/fixtures";

export const metadata: Metadata = { title: "Today · CareerMetro", robots: { index: false } };

// Example data for the signed-out preview and the No resume state. A signed-in person with a line gets their own ride,
// goals, signal check, board, people on their line and Timetable teaser.
const data: TodayData = {
  name: exampleName,
  role: exampleRole,
  ride: exampleRide,
  week: exampleWeek,
  departures: exampleDepartures,
  goals: exampleGoals,
  tally: exampleFirstTally,
  firstTasks: exampleFirstTasks,
  lineHours: 46,
  signalCheck: exampleSignalCheck,
  events: exampleEvents,
  onYourLine: exampleOnYourLine,
  nextInterview: exampleNextInterview,
  greeting: "Evening",
};

function readState(value: string | string[] | undefined): UserState {
  const v = Array.isArray(value) ? value[0] : value;
  return (USER_STATES as readonly string[]).includes(v ?? "") ? (v as UserState) : "returning";
}

async function Today({ searchParams }: PageProps<"/today">) {
  const params = await searchParams;
  const requested = readState(params.state);
  await connection();
  const account = await currentAccount();
  const greeting = greetingAt(new Date());
  if (!account) {
    // Example mode (no sign-in on this deployment): ?state=no_resume|first|returning shows each state.
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example data. Your own ride, goals and departures appear here as we build them.</Banner>
        <TodayView state={requested} data={{ ...data, greeting }} upload={<Upload key="upload" />} departuresHref="/departures" />
      </div>
    );
  }
  // Signed in: the server picks the state from the person's own resume and gaps.
  const now = new Date();
  // The current analysis is read once here and handed to the ride and the board (docs/plans/perf-pass.md).
  const [analysis, searching] = await Promise.all([currentAnalysis(account.id), jobSearchForRequest(account.id).then((s) => s.on)]);
  const name = firstName(account.name);
  // The board's open posts need only the person's places (Settings), so their read starts now, beside the ride; fit is read after
  // the ride, which syncs the goals fit reads. Job search off, or No resume, reads none. The no-op catch only keeps a
  // failed read from counting as unhandled while the ride runs: the board below still sees the failure.
  const openPosts = analysis && searching ? departuresBoard(null, { placesOf: account.id }) : null;
  if (openPosts) openPosts.catch(() => {});
  // The Timetable teaser: the next two live events on the person's goals or interests, in any state; none hides it.
  const teaser = timetableTeaserFor(account.id, now).catch(failed<EventTeaser[]>("today_timetable_failed", []));
  const [found, sample] = await Promise.all([todayStateFor(account.id, now, undefined, analysis), analysis ? isSampleResumeId(analysis.resumeId) : false]);
  // The live cards never fail the page: a card that can't be read is left out (the board shows it has no rows).
  const [board, line, interview]: [Departure[], OnYourLine | null, NextInterviewView | null] =
    found.state === "no_resume"
      ? [[], null, null]
      : await Promise.all([
          // Job search off sends no board rows; the card says how to turn it on (handoff 6).
          openPosts
            ? todayBoardFor(account.id, now, undefined, { analysis, posts: openPosts }).catch(failed<Departure[]>("today_board_failed", []))
            : Promise.resolve<Departure[]>([]),
          found.current
            ? onYourLineFor(account.id, found.current, { firstDay: found.state === "first", now }).catch(failed<OnYourLine | null>("today_line_failed", null))
            : Promise.resolve(null),
          // "Interview in 2 days" from My jobs (handoff 12m), counted in India days here so the page and the card agree.
          nextInterview(account.id, { now }).catch(failed<NextInterviewView | null>("today_interview_failed", null)),
        ]);
  // C20: the job's still-open skills that lead today's ride, only on a returning day; left out when it can't be read.
  const today = found.state === "returning" ? found.current : null;
  const lead =
    interview && today
      ? await jobPrep(account.id, interview.ref, { now })
          // Today's ride holds one goal, so only its skill can lead it (T155).
          .then((prep) => leadSkills(prep?.open ?? [], [today.skillId]))
          .catch(failed<string[]>("today_interview_skills_failed", []))
      : [];
  const nextUp = interview ? { ...interview, days: daysUntil(interview.interviewAt, now), leadSkills: lead } : null;
  const signal = found.state === "no_resume" ? null : found.signal;
  const events = await teaser;
  const own: TodayData =
    found.state === "first"
      ? {
          ...data,
          name,
          greeting,
          role: found.role.title,
          tally: found.tally,
          lineHours: found.lineHours,
          weeklyHours: account.weeklyHours,
          firstTasks: signal ? withSignalTask(found.firstTasks, signal.day, signal.done) : found.firstTasks,
          goals: found.goals ?? { track: found.role.title, goals: [], moreCount: 0, moreNames: [], suggestedGoal: null, metThisMonth: [] },
          departures: board,
          signalCheck: null,
          signalLive: signal?.live ?? null,
          onYourLine: line,
          nextInterview: nextUp,
          events,
        }
      : found.state === "returning"
        ? {
            ...data,
            name,
            greeting,
            role: found.role.title,
            ride: signal ? rideWithSignal(found.ride, signal.day, signal.done) : found.ride,
            goals: found.goals,
            week: found.week,
            departures: board,
            signalCheck: null,
            signalLive: signal?.live ?? null,
            onYourLine: line,
            nextInterview: nextUp,
            events,
          }
        : { ...data, name, greeting, events, unfinishedHref: found.unfinishedResumeId ? `/resume/${found.unfinishedResumeId}` : null };
  return (
    <div className="flex flex-col gap-4">
      {params.notice === NAME_NOTICE && (
        <p role="status" className="rounded-md border border-line bg-surface px-3.5 py-2 text-[0.8rem] text-ink">
          {NAME_MISMATCH_MESSAGE}
        </p>
      )}
      <Banner>
        {found.state === "no_resume"
          ? "Add your resume to start. The departures below are example data until then."
          : "Everything here is your own."}
      </Banner>
      {sample && found.state !== "no_resume" && <SampleLineNote />}
      {/* Job search off hides the Departures board (handoff 6): no board rows are sent, and the card says how to turn it on. */}
      <JobSearchProvider initialOn={searching} action={switchJobSearch}>
        <TodayView
          state={found.state}
          data={own}
          // Only the No resume state shows the upload form; leaving it out otherwise keeps it out of the page's payload.
          upload={found.state === "no_resume" ? <Upload key="upload" /> : null}
          departuresHref="/departures"
          mapHref="/map"
          onToggleTask={tickRideTask}
          onAddCertificate={addCertificate}
          onHours={saveWeeklyHours}
          onAnswerSignal={answerSignalCheck}
          onChooseTrack={chooseTrack}
        />
      </JobSearchProvider>
    </div>
  );
}

/** A live card that couldn't be read: logged by event name only, and left out. */
function failed<T>(event: string, fallback: T) {
  return (error: unknown): T => {
    logEvent("error", event, errorFields(error));
    return fallback;
  };
}

function Upload() {
  return (
    <div className="flex flex-col gap-3">
      <LocalTestNotice />
      <UploadForm builder rolePick sample />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function TodayPage(props: PageProps<"/today">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Today {...props} />
    </Suspense>
  );
}
