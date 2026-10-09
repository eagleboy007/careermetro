"use client";

import { useState, type ReactNode } from "react";
import {
  USER_STATES,
  type Departure,
  type GoalsSummary,
  type Ride,
  type RideTask,
  type RideWeek,
  type SignalCheck,
  type UserState,
} from "@/lib/schemas";
import { USER_STATE_LABELS } from "@/lib/today/fixtures";
import { DeparturesBoard } from "./departures-board";
import { GoalsCard } from "./goals-card";
import { NoResumeHero } from "./no-resume-hero";
import { RideCard } from "./ride-card";
import { SignalCheckCard } from "./signal-check";
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
  signalCheck: SignalCheck;
};

/**
 * The Today screen for one user state. The server picks the state; `upload` is the upload form for No resume.
 * `onToggleTask` saves a tick, including the locked signal check task when the question is answered.
 */
export function TodayView({
  state,
  data,
  upload,
  onToggleTask,
}: {
  state: UserState;
  data: TodayData;
  upload: ReactNode;
  onToggleTask?: (taskId: string, done: boolean) => void;
}) {
  const lockedTask = data.ride.tasks.find((t) => t.locked);
  // Answered earlier today when the locked task already came back done; the picked key is only known this visit.
  const [answer, setAnswer] = useState<{
    answered: boolean;
    key: string | null;
  }>(() => ({ answered: Boolean(lockedTask?.done), key: null }));

  function answerSignal(key: string) {
    setAnswer({ answered: true, key });
    if (lockedTask && !lockedTask.done) onToggleTask?.(lockedTask.id, true);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="lg:col-span-2">
        {state === "no_resume" && <NoResumeHero name={data.name} upload={upload} />}
        {state === "first" && (
          <WelcomeHero name={data.name} role={data.role} tally={data.tally} firstTasks={data.firstTasks} lineHours={data.lineHours} />
        )}
        {state === "returning" && (
          <RideCard name={data.name} ride={data.ride} week={data.week} signalAnswered={answer.answered} onToggle={onToggleTask} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {state === "returning" && (
          <SignalCheckCard check={data.signalCheck} answered={answer.answered} pickedKey={answer.key} onAnswer={answerSignal} />
        )}
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
