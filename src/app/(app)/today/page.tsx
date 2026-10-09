import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { UploadForm } from "@/components/resume/upload-form";
import { TodayView, type TodayData } from "@/components/today/today-preview";
import { currentAccount } from "@/lib/auth/server";
import { USER_STATES, type UserState } from "@/lib/schemas";
import { greetingAt } from "@/lib/today/board";
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
  // Preview only: ?state=no_resume|first|returning. The server will pick the state once accounts exist.
  const state = readState((await searchParams).state);
  await connection();
  const account = await currentAccount();
  const name = account?.name?.split(/\s+/)[0] ?? data.name;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        Preview with example data. Your own ride, goals and departures appear here as we build them.
      </p>
      <TodayView state={state} data={{ ...data, name, greeting: greetingAt(new Date()) }} upload={<UploadForm />} />
    </div>
  );
}

export default function TodayPage(props: PageProps<"/today">) {
  return (
    <Suspense>
      <Today {...props} />
    </Suspense>
  );
}
