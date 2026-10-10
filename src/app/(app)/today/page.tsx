import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { UploadForm } from "@/components/resume/upload-form";
import { TodayView, type TodayData } from "@/components/today/today-preview";
import { currentAccount } from "@/lib/auth/server";
import { USER_STATES, type UserState } from "@/lib/schemas";
import { greetingAt } from "@/lib/today/board";
import { todayStateFor } from "@/lib/today/state";
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

// Example data until the ride tables exist (handoff build steps 4 to 6). A signed-in person sees their own first name.
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
  const requested = readState((await searchParams).state);
  await connection();
  const account = await currentAccount();
  const greeting = greetingAt(new Date());
  if (!account) {
    // Example mode (no sign-in on this deployment): ?state=no_resume|first|returning shows each state.
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example data. Your own ride, goals and departures appear here as we build them.</Banner>
        <TodayView state={requested} data={{ ...data, greeting }} upload={<UploadForm />} departuresHref="/departures" />
      </div>
    );
  }
  // Signed in: the server picks the state from the person's own resume and gaps.
  const found = await todayStateFor(account.id);
  const name = account.name?.split(/\s+/)[0] ?? data.name;
  const own: TodayData =
    found.state === "first"
      ? { ...data, name, greeting, role: found.role.title, tally: found.tally, lineHours: found.lineHours, firstTasks: found.firstTasks }
      : { ...data, name, greeting, unfinishedHref: found.unfinishedResumeId ? `/resume/${found.unfinishedResumeId}` : null };
  return (
    <div className="flex flex-col gap-4">
      <Banner>
        {found.state === "first"
          ? "Your welcome card comes from your resume. The rest is example data until we build it."
          : "Add your resume to start. The cards below are example data until we build them."}
      </Banner>
      <TodayView state={found.state} data={own} upload={<UploadForm />} departuresHref="/departures" />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function TodayPage(props: PageProps<"/today">) {
  return (
    <Suspense>
      <Today {...props} />
    </Suspense>
  );
}
