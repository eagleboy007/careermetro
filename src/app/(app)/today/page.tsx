import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { JobSearchProvider } from "@/components/job-search/job-search";
import { LocalTestNotice } from "@/components/resume/local-test-notice";
import { UploadForm } from "@/components/resume/upload-form";
import { TodayView, type TodayData } from "@/components/today/today-preview";
import { firstName } from "@/lib/account/name";
import { NAME_NOTICE } from "@/lib/auth/after-sign-in";
import { currentAccount } from "@/lib/auth/server";
import { NAME_MISMATCH_MESSAGE } from "@/lib/resume/name-match";
import { USER_STATES, type Departure, type OnYourLine, type UserState } from "@/lib/schemas";
import { jobSearchOn } from "@/lib/job-search/store";
import { errorFields, logEvent } from "@/lib/log";
import { rideWithSignal, withSignalTask } from "@/lib/ride/build";
import { greetingAt } from "@/lib/today/board";
import { onYourLineFor, todayBoardFor } from "@/lib/today/live";
import { todayStateFor } from "@/lib/today/state";
import { switchJobSearch } from "../settings/job-search-actions";
import { addCertificate, answerSignalCheck, saveWeeklyHours, tickRideTask } from "./actions";
import {
  exampleDepartures,
  exampleEvents,
  exampleFirstTally,
  exampleFirstTasks,
  exampleGoals,
  exampleName,
  exampleOnYourLine,
  exampleRide,
  exampleSignalCheck,
  exampleRole,
  exampleWeek,
} from "@/lib/today/fixtures";

export const metadata: Metadata = { title: "Today · CareerMetro", robots: { index: false } };

// Example data for the signed-out preview and the No resume state. A signed-in person with a line gets their own ride,
// goals, signal check, board and people on their line; only the Timetable stays example data.
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
  const [found, searching] = await Promise.all([todayStateFor(account.id, now), jobSearchOn(account.id)]);
  const name = firstName(account.name);
  // The live cards never fail the page: a card that can't be read is left out (the board shows it has no rows).
  const [board, line]: [Departure[], OnYourLine | null] =
    found.state === "no_resume"
      ? [[], null]
      : await Promise.all([
          // Job search off sends no board rows; the card says how to turn it on (handoff 6).
          searching ? todayBoardFor(account.id, now).catch(failed<Departure[]>("today_board_failed", [])) : Promise.resolve<Departure[]>([]),
          found.current
            ? onYourLineFor(account.id, found.current, { firstDay: found.state === "first", now }).catch(failed<OnYourLine | null>("today_line_failed", null))
            : Promise.resolve(null),
        ]);
  const signal = found.state === "no_resume" ? null : found.signal;
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
          }
        : { ...data, name, greeting, unfinishedHref: found.unfinishedResumeId ? `/resume/${found.unfinishedResumeId}` : null };
  return (
    <div className="flex flex-col gap-4">
      {params.notice === NAME_NOTICE && (
        <p role="status" className="rounded-md border border-line bg-surface px-3.5 py-2 text-[0.8rem] text-ink">
          {NAME_MISMATCH_MESSAGE}
        </p>
      )}
      <Banner>
        {found.state === "no_resume"
          ? "Add your resume to start. The cards below are example data until we build them."
          : "Everything here is your own except the Timetable, which is example data until we build it."}
      </Banner>
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
      <UploadForm builder rolePick />
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
