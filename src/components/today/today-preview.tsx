"use client";

import { useState, type ReactNode } from "react";
import { USER_STATES, type Departure, type GoalsSummary, type Ride, type RideTask, type RideWeek, type UserState } from "@/lib/schemas";
import { USER_STATE_LABELS } from "@/lib/today/fixtures";
import { DeparturesBoard } from "./departures-board";
import { GoalsCard } from "./goals-card";
import { NoResumeHero } from "./no-resume-hero";
import { RideCard } from "./ride-card";
import { WelcomeHero, type FirstTally } from "./welcome-hero";

export type TodayData = {
  name: string;
  role: string;
  ride: Ride;
  week: RideWeek;
  departures: Departure[];
  goals: GoalsSummary;
  tally: FirstTally;
  firstTasks: RideTask[];
  lineHours: number;
};

/** The Today screen for one user state. The server picks the state; `upload` is the upload form for No resume. */
export function TodayView({ state, data, upload }: { state: UserState; data: TodayData; upload: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="lg:col-span-2">
        {state === "no_resume" && <NoResumeHero name={data.name} upload={upload} />}
        {state === "first" && (
          <WelcomeHero name={data.name} role={data.role} tally={data.tally} firstTasks={data.firstTasks} lineHours={data.lineHours} />
        )}
        {state === "returning" && <RideCard name={data.name} ride={data.ride} week={data.week} />}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <DeparturesBoard rows={data.departures} locked={state === "no_resume"} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {state === "no_resume" ? (
          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-5 py-4 text-[0.88rem]">
            <h3 className="text-[1.08rem] font-semibold">Your goals</h3>
            <p className="text-muted">Your goals come from your resume: one for each gap.</p>
          </section>
        ) : (
          <GoalsCard summary={data.goals} />
        )}
      </div>
    </div>
  );
}

/** Design page only: switch between the three user states with example data. */
export function TodayStatePreview({ data, upload }: { data: TodayData; upload: ReactNode }) {
  const [state, setState] = useState<UserState>("returning");
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="User state" className="flex flex-wrap gap-1">
        {USER_STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === state}
            onClick={() => setState(s)}
            className="rounded-full border border-line px-3 py-1 text-[0.8rem] font-medium text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink"
          >
            {USER_STATE_LABELS[s]}
          </button>
        ))}
      </div>
      <TodayView state={state} data={data} upload={upload} />
    </div>
  );
}
