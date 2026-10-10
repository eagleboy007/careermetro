"use client";

import { useState, type ReactNode } from "react";
import {
  USER_STATES,
  type Departure,
  type EventTeaser,
  type GoalsSummary,
  type OnYourLine,
  type Ride,
  type RideTask,
  type RideWeek,
  type SignalCheck,
  type UserState,
} from "@/lib/schemas";
import { USER_STATE_LABELS } from "@/lib/today/fixtures";
import { DeparturesBoard } from "./departures-board";
import { GoalsCard } from "./goals-card";
import { NoResumeHero, WhileYouDecide } from "./no-resume-hero";
import { OnYourLineCard, TimetableTeaser } from "./rail-cards";
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
  events: EventTeaser[];
  onYourLine: OnYourLine;
  /** "Morning", "Afternoon" or "Evening" in the user's time zone. */
  greeting: string;
  /** No resume state: a resume that was read but whose gaps were never shown. */
  unfinishedHref?: string | null;
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

  // Prototype v2 layout: the hero across the top, then signal check and Your goals on the left, the departures board,
  // Timetable and the people on your line in the right column. One column under 960 px.
  return (
    <div className="grid items-start gap-4 min-[960px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] min-[960px]:gap-[22px]">
      <div className="min-w-0 min-[960px]:col-span-2">
        {state === "no_resume" && <NoResumeHero name={data.name} upload={upload} unfinishedHref={data.unfinishedHref} />}
        {state === "first" && (
          <WelcomeHero name={data.name} role={data.role} tally={data.tally} firstTasks={data.firstTasks} lineHours={data.lineHours} />
        )}
        {state === "returning" && (
          <RideCard
            name={data.name}
            greeting={data.greeting}
            ride={data.ride}
            week={data.week}
            signalAnswered={answer.answered}
            onToggle={onToggleTask}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4 min-[960px]:gap-[22px]">
        {state === "no_resume" ? (
          <WhileYouDecide />
        ) : (
          <>
            <SignalCheckCard check={data.signalCheck} answered={answer.answered} pickedKey={answer.key} onAnswer={answerSignal} />
            <GoalsCard summary={data.goals} firstDay={state === "first"} />
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4 min-[960px]:gap-[22px]">
        <DeparturesBoard rows={data.departures} locked={state === "no_resume"} />
        <TimetableTeaser events={data.events} />
        {state !== "no_resume" && <OnYourLineCard line={data.onYourLine} firstDay={state === "first"} />}
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
