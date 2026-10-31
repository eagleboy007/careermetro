"use client";

import { useState, type ReactNode } from "react";
import type { CertificateInput, CertificateResult } from "@/lib/proofs/result";
import type {
  Departure,
  EventTeaser,
  GoalsSummary,
  OnYourLine,
  Ride,
  RideTask,
  RideWeek,
  SignalAnswer,
  SignalAnswerResult,
  SignalCheck,
  SignalLive,
  UserState,
} from "@/lib/schemas";
import { USER_STATES } from "@/lib/schemas/constants";
import { USER_STATE_LABELS } from "@/lib/today/fixtures";
import { JobSearchBoardSlot } from "@/components/job-search/job-search";
import { DeparturesBoard } from "./departures-board";
import { GoalsCard } from "./goals-card";
import { NoResumeHero, WhileYouDecide } from "./no-resume-hero";
import { NextInterviewCard, OnYourLineCard, TimetableTeaser, type NextInterview } from "./rail-cards";
import { RideCard } from "./ride-card";
import { SignalCheckCard } from "./signal-check";
import { WelcomeHero, type FirstTally } from "./welcome-hero";

/** What the signal check card says when an answer didn't go through. */
const SIGNAL_ERRORS: Record<"stale" | "limit" | "invalid", string> = {
  stale: "Today's question changed. Reload Today for the new one.",
  limit: "That's as many answers as we take in a day. Try again tomorrow.",
  invalid: "That didn't go through. Please try again.",
};

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
  /** The signed-in person's saved hours a week. */
  weeklyHours?: number;
  /** Example data (signed out and /design). Null hides the card. */
  signalCheck: SignalCheck | null;
  /**
   * A signed-in person's question from the Practice bank, checked on the server (`onAnswerSignal`). Used instead of
   * `signalCheck` when set; null hides the card (no question for today's goal or the next).
   */
  signalLive?: SignalLive | null;
  events: EventTeaser[];
  /** Null hides the card: fewer than three people on the goal who can be counted. */
  onYourLine: OnYourLine | null;
  /** JUNCTION_ENABLED, read on the server: the line card's "Ask on Junction" is a link only while it is on. */
  junction?: boolean;
  /** The soonest interview set in My jobs (handoff 12m); null or absent hides the card. */
  nextInterview?: NextInterview | null;
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
  onAddCertificate,
  onHours,
  onAnswerSignal,
  onChooseTrack,
  departuresHref,
  mapHref,
}: {
  state: UserState;
  data: TodayData;
  upload: ReactNode;
  onToggleTask?: (taskId: string, done: boolean) => void | Promise<boolean>;
  /** Saves a certificate for the ride's prove pitstop. */
  onAddCertificate?: (input: CertificateInput) => Promise<CertificateResult>;
  /** Saves the hours a week picked on the welcome card. */
  onHours?: (hours: number) => void | Promise<boolean>;
  /** Checks a live signal check answer on the server, which ticks the ride's signal task, or says why it didn't. */
  onAnswerSignal?: (questionId: string, key: string) => Promise<SignalAnswerResult>;
  /** Saves a track picked on Your goals' Track picker (null for the whole role), or says why it didn't. */
  onChooseTrack?: (trackId: string | null) => Promise<string | null>;
  /** Where "All departures" goes; without it the link is marked "soon". */
  departuresHref?: string;
  /** Where Your goals' map links go; without it they are marked "soon". */
  mapHref?: string;
}) {
  const live = data.signalLive;
  const shown = live === undefined ? data.signalCheck : (live?.shown ?? null);
  // The signal task is the ride's last task: on the welcome card's first tasks on the first day.
  const lockedTask = (state === "first" ? data.firstTasks : data.ride.tasks).find((t) => t.signal);
  const exampleAnswer = data.signalCheck ? { correctKey: data.signalCheck.correctKey, explanation: data.signalCheck.explanation } : null;
  // Answered earlier today when the server sent the answer (live) or the locked task came back done (example); the
  // picked key is only known this visit. The state is kept with the question it belongs to: a refresh that brings a new
  // question (a goal skipped, or midnight in India) starts from what the server says about that one.
  type Answer = { id: string | null; answered: boolean; key: string | null; reveal: SignalAnswer | null; error: string | null };
  const fromServer = (l: SignalLive): Answer => ({ id: l.id, answered: l.answer !== null, key: null, reveal: l.answer, error: null });
  const [answer, setAnswer] = useState<Answer>(() => {
    if (live) return fromServer(live);
    const earlier = lockedTask?.done ? exampleAnswer : null;
    return { id: null, answered: earlier !== null, key: null, reveal: earlier, error: null };
  });
  const a = live && answer.id !== live.id ? fromServer(live) : answer;

  function answerSignal(key: string) {
    if (!live) {
      setAnswer({ id: null, answered: true, key, reveal: exampleAnswer, error: null });
      if (lockedTask && !lockedTask.done) onToggleTask?.(lockedTask.id, true);
      return;
    }
    // Checked on the server, which ticks the signal task; the card waits for the answer and opens again if it fails.
    const id = live.id;
    setAnswer({ id, answered: true, key, reveal: null, error: null });
    const failed = (error: string) => setAnswer({ id, answered: false, key: null, reveal: null, error });
    Promise.resolve(onAnswerSignal?.(id, key) ?? null).then(
      (r) => (r?.ok ? setAnswer({ id, answered: true, key, reveal: r.answer, error: null }) : failed(SIGNAL_ERRORS[r?.reason ?? "invalid"])),
      () => failed(SIGNAL_ERRORS.invalid),
    );
  }
  const signalAnswered = a.answered && a.reveal !== null;

  // Prototype v2 layout: the hero across the top, then signal check and Your goals on the left, the departures board,
  // Timetable and the people on your line in the right column. One column under 960 px.
  return (
    <div className="grid items-start gap-4 min-[960px]:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] min-[960px]:gap-[22px]">
      <div className="min-w-0 min-[960px]:col-span-2">
        {state === "no_resume" && <NoResumeHero name={data.name} upload={upload} unfinishedHref={data.unfinishedHref} />}
        {state === "first" && (
          <WelcomeHero
            name={data.name}
            role={data.role}
            tally={data.tally}
            firstTasks={data.firstTasks}
            lineHours={data.lineHours}
            weeklyHours={data.weeklyHours}
            onHours={onHours}
            onToggle={onToggleTask}
            signalAnswered={signalAnswered}
          />
        )}
        {state === "returning" && (
          <RideCard
            name={data.name}
            greeting={data.greeting}
            ride={data.ride}
            week={data.week}
            signalAnswered={signalAnswered}
            onToggle={onToggleTask}
            onAddCertificate={onAddCertificate}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4 min-[960px]:gap-[22px]">
        {state === "no_resume" ? (
          <WhileYouDecide />
        ) : (
          <>
            {shown && (
              <SignalCheckCard check={shown} answered={a.answered} pickedKey={a.key} reveal={a.reveal} error={a.error} onAnswer={answerSignal} />
            )}
            <GoalsCard summary={data.goals} mapHref={mapHref} firstDay={state === "first"} onChooseTrack={onChooseTrack} />
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4 min-[960px]:gap-[22px]">
        {/* Hidden on the first day and with no resume (C20). */}
        {state === "returning" && data.nextInterview && <NextInterviewCard next={data.nextInterview} />}
        {/* Inside a JobSearchProvider, job search off shows "Job search is off" in the board's place (handoff 6). */}
        {state === "no_resume" ? (
          <DeparturesBoard rows={data.departures} locked allHref={departuresHref} />
        ) : (
          <JobSearchBoardSlot>
            <DeparturesBoard rows={data.departures} allHref={departuresHref} />
          </JobSearchBoardSlot>
        )}
        {/* Hidden when no event matches the person (docs/plans/timetable-plan.md section 7). */}
        {data.events.length > 0 && <TimetableTeaser events={data.events} />}
        {state !== "no_resume" && data.onYourLine && <OnYourLineCard line={data.onYourLine} firstDay={state === "first"} junction={data.junction} />}
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
