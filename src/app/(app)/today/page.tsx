import type { Metadata } from "next";
import { Suspense } from "react";
import { UploadForm } from "@/components/resume/upload-form";
import { TodayView, type TodayData } from "@/components/today/today-preview";
import { USER_STATES, type UserState } from "@/lib/schemas";
import {
  exampleDepartures,
  exampleFirstTally,
  exampleFirstTasks,
  exampleGoals,
  exampleName,
  exampleRide,
  exampleRole,
  exampleWeek,
} from "@/lib/today/fixtures";

export const metadata: Metadata = { title: "Today · CareerMetro", robots: { index: false } };

// Example data until sign-in and the ride tables exist (handoff build steps 3 to 6).
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
};

function readState(value: string | string[] | undefined): UserState {
  const v = Array.isArray(value) ? value[0] : value;
  return (USER_STATES as readonly string[]).includes(v ?? "") ? (v as UserState) : "returning";
}

async function Today({ searchParams }: PageProps<"/today">) {
  // Preview only: ?state=no_resume|first|returning. The server will pick the state once accounts exist.
  const state = readState((await searchParams).state);
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        Preview with example data. Your own ride appears here once sign-in is live.
      </p>
      <TodayView state={state} data={data} upload={<UploadForm />} />
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
