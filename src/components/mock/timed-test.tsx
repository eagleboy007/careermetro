"use client";

import { Check, Clock, Lock, Minus, Play, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MockRole, TimedTestFinishResult, TimedTestPickResult, TimedTestReview, TimedTestStartResult, TimedTestView } from "@/lib/schemas";
import { TIMED_TEST_MINUTES, TIMED_TEST_QUESTIONS } from "@/lib/schemas/constants";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const CARD = "flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[18px] py-4";
const BTN = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-[0.86rem] font-[550] aria-disabled:cursor-wait aria-disabled:opacity-60";
const INK = `${BTN} bg-ink text-bg hover:opacity-90`;
const GHOST = `${BTN} border border-line-strong bg-surface text-ink hover:bg-surface-2`;

/** "9:05" for the timer. */
export const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
/** The only number the review shows (handoff 12l). */
export const rightText = (right: number, total: number) => `${right} of ${total} right`;
/** What the review says under each question. */
export function pickedText(options: readonly string[], pick: number | null, answer: number): string {
  if (pick === null) return `No answer. The answer is ${options[answer]}.`;
  return pick === answer ? `You picked ${options[pick]}, the right answer.` : `You picked ${options[pick]}. The answer is ${options[answer]}.`;
}

type Phase = { kind: "idle" } | { kind: "running"; test: TimedTestView } | { kind: "review"; review: TimedTestReview };

/**
 * The timed test tab of /mock (handoff 12l, prototype v44): 12 multiple-choice questions in 15 minutes, then every
 * question with the right answer explained and the count right, the only number shown. Each pick is saved as it is
 * made, and the server decides what counts: nothing after the 15 minutes. Cobalt is only the progress bar. Without
 * actions (example data) nothing is saved and the clock stands still.
 */
export function TimedTest({
  elite,
  role,
  initial,
  initialReview,
  onStart,
  onPick,
  onFinish,
}: {
  elite: boolean;
  role: MockRole;
  initial: TimedTestView | null;
  /** For /design: open on a review. */
  initialReview?: TimedTestReview;
  onStart?: (roleSlug: string) => Promise<TimedTestStartResult>;
  onPick?: (testId: string, questionId: string, pick: number) => Promise<TimedTestPickResult>;
  onFinish?: (testId: string) => Promise<TimedTestFinishResult>;
}) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>(initialReview ? { kind: "review", review: initialReview } : initial ? { kind: "running", test: initial } : { kind: "idle" });
  const [at, setAt] = useState(() => (initial ? Math.max(0, initial.picks.findIndex((p) => p === null)) : 0));
  const [picks, setPicks] = useState<(number | null)[]>(initial?.picks ?? []);
  const [left, setLeft] = useState(initial?.secondsLeft ?? TIMED_TEST_MINUTES * 60);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deadline = useRef<number | null>(null);
  const finishing = useRef(false);
  const timedOut = useRef(false);

  // Focus moves after a press only: to the question after Start, Next or Back, and to the review once it is in.
  const [focusTick, setFocusTick] = useState(0);
  const focusTarget = useRef<"question" | "review">("question");
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTick === 0) return;
    (focusTarget.current === "question" ? questionHeading : reviewHeading).current?.focus();
  }, [focusTick]);
  const moveFocus = (to: "question" | "review") => {
    focusTarget.current = to;
    setFocusTick((n) => n + 1);
  };

  const testId = phase.kind === "running" ? phase.test.id : null;

  const finish = useCallback(async () => {
    if (!testId || finishing.current) return;
    if (!onFinish) {
      setMessage("Example data: sign in to finish a test.");
      return;
    }
    finishing.current = true;
    setBusy(true);
    const out = await onFinish(testId).catch((): TimedTestFinishResult => ({ ok: false, message: "That didn't work. Please try again." }));
    finishing.current = false;
    setBusy(false);
    if (!out.ok) {
      setMessage(out.message);
      return;
    }
    setMessage(null);
    deadline.current = null;
    setPhase({ kind: "review", review: out.review });
    focusTarget.current = "review";
    setFocusTick((n) => n + 1);
  }, [onFinish, testId]);

  // The clock counts down to the deadline, not by ticks, so a slow tab can't stretch it; at 0 the test finishes.
  useEffect(() => {
    if (phase.kind !== "running" || !onFinish) return;
    if (deadline.current === null) deadline.current = Date.now() + phase.test.secondsLeft * 1000;
    const timer = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline.current! - Date.now()) / 1000));
      setLeft(s);
      // Finishes once when the time runs out; if that fails, "Finish test" tries again.
      if (s === 0 && !timedOut.current) {
        timedOut.current = true;
        void finish();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, onFinish, finish]);

  const start = async () => {
    if (busy) return;
    if (!onStart) {
      setMessage("Example data: sign in to take a test.");
      return;
    }
    setBusy(true);
    const out = await onStart(role.slug).catch((): TimedTestStartResult => ({ ok: false, message: "That didn't work. Please try again." }));
    setBusy(false);
    if (!out.ok) {
      setMessage(out.message);
      return;
    }
    setMessage(null);
    deadline.current = null;
    timedOut.current = false;
    setPicks(out.test.picks);
    setAt(0);
    setLeft(out.test.secondsLeft);
    setPhase({ kind: "running", test: out.test });
    moveFocus("question");
  };

  if (!elite) {
    return (
      <section aria-labelledby={`${id}-h`} className={CARD}>
        <h2 id={`${id}-h`} className="font-sans text-[1.05rem] font-semibold">
          Timed test
        </h2>
        <p className="flex items-start gap-2 text-[0.86rem] text-muted">
          <Lock size={16} {...ICON} className="mt-0.5 shrink-0" />
          {TIMED_TEST_QUESTIONS} questions in {TIMED_TEST_MINUTES} minutes, like the screening tests companies send, then every question explained. Timed tests open with Elite.
        </p>
      </section>
    );
  }

  if (phase.kind === "review") {
    const r = phase.review;
    return (
      <section aria-labelledby={`${id}-rh`} className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={`${id}-rh`} ref={reviewHeading} tabIndex={-1} className="mr-auto font-sans text-[1.05rem] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
            Your test review
          </h2>
          <span className={LABEL}>{r.roleTitle}</span>
        </div>
        <p className="font-display text-[1.4rem] font-semibold tracking-[-0.015em]">{rightText(r.right, r.total)}.</p>
        <p className="-mt-2 text-[0.84rem] text-muted">Every question with the right answer and why. A test gets you ready; only proof fills a goal.</p>
        <ol className="flex flex-col">
          {r.items.map((q, i) => {
            const right = q.pick === q.answer;
            const Mark = q.pick === null ? Minus : right ? Check : X;
            return (
              <li key={q.id} data-review-item={right ? "right" : "missed"} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0">
                <span className={LABEL}>
                  {i + 1} · {q.topic}
                </span>
                <b className="text-[0.92rem] font-[550]">{q.question}</b>
                <span className="inline-flex items-start gap-1.5 text-[0.84rem] text-ink">
                  <Mark size={15} {...ICON} className="mt-[3px] shrink-0" />
                  {pickedText(q.options, q.pick, q.answer)}
                </span>
                <p className="text-[0.84rem] text-muted">{q.explanation}</p>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={start} aria-disabled={busy || undefined} className={INK}>
            <Play size={16} {...ICON} />
            Take another test
          </button>
          <p role="status" className="text-[0.8rem] text-muted">
            {message}
          </p>
        </div>
      </section>
    );
  }

  if (phase.kind === "idle") {
    return (
      <section aria-labelledby={`${id}-h`} className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={`${id}-h`} className="mr-auto font-sans text-[1.05rem] font-semibold">
            Timed test
          </h2>
          <span className={LABEL}>{role.title}</span>
        </div>
        {role.hasTest ? (
          <>
            <p className="max-w-[62ch] text-[0.88rem] text-muted">
              {TIMED_TEST_QUESTIONS} questions in {TIMED_TEST_MINUTES} minutes, like the screening tests companies send. Pick one answer each; you can go back
              until the time is up. At the end you see every question explained.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={start} aria-disabled={busy || undefined} className={INK}>
                <Play size={16} {...ICON} />
                Start the test
              </button>
              <p role="status" className="text-[0.8rem] text-muted">
                {message}
              </p>
            </div>
          </>
        ) : (
          <p className="text-[0.88rem] text-muted">Timed test for this role is coming. The question bank below is open now.</p>
        )}
      </section>
    );
  }

  const test = phase.test;
  const q = test.questions[Math.min(at, test.questions.length - 1)];
  const answered = picks.filter((p) => p !== null).length;
  const last = at >= test.questions.length - 1;
  const low = left <= 60;

  const choose = async (option: number) => {
    const before = picks[at] ?? null;
    if (before === option) return;
    const position = at;
    setPicks((all) => all.map((p, i) => (i === position ? option : p)));
    if (!onPick) return;
    const out = await onPick(test.id, q.id, option).catch((): TimedTestPickResult => ({ ok: false, message: "That pick didn't save. Please pick again.", over: false }));
    if (out.ok) {
      setMessage(null);
      return;
    }
    setPicks((all) => all.map((p, i) => (i === position ? before : p)));
    setMessage(out.message);
    if (out.over) void finish();
  };
  const go = (to: number) => {
    setAt(to);
    setMessage(null);
    moveFocus("question");
  };

  return (
    <section aria-labelledby={`${id}-th`} className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`${id}-th`} className="mr-auto font-sans text-[1.05rem] font-semibold">
          Timed test · {test.roleTitle}
        </h2>
        <span
          role="timer"
          aria-label={`Time left ${clockText(left)}`}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.86rem] ${low ? "bg-ink text-bg" : "bg-surface-2 text-ink"}`}
        >
          <Clock size={14} {...ICON} />
          {clockText(left)}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[0.78rem] text-muted">
          <span>
            Question {at + 1} of {test.questions.length}
          </span>
          <span>{answered} answered</span>
        </div>
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(answered / test.questions.length) * 100}%` }} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className={LABEL}>{q.topic}</span>
        <h3 id={`${id}-q`} ref={questionHeading} tabIndex={-1} className="font-display text-[1.15rem] font-semibold leading-snug tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-accent">
          {q.question}
        </h3>
        <div role="radiogroup" aria-labelledby={`${id}-q`} className="flex flex-col gap-2">
          {q.options.map((o, i) => (
            <label
              key={`${q.id}-${i}`}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-line-strong px-3.5 py-2.5 text-[0.92rem] has-[:checked]:border-ink has-[:checked]:shadow-[inset_0_0_0_1px_var(--ink)]"
            >
              <input type="radio" name={`${id}-${q.id}`} value={i} checked={picks[at] === i} onChange={() => void choose(i)} className="size-4 accent-[var(--ink)]" />
              <span>{o}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {at > 0 && (
          <button type="button" onClick={() => go(at - 1)} className={GHOST}>
            Back
          </button>
        )}
        {last || left === 0 ? (
          <button type="button" onClick={() => void finish()} aria-disabled={busy || undefined} className={INK}>
            Finish test
          </button>
        ) : (
          <button type="button" onClick={() => go(at + 1)} className={INK}>
            Next
          </button>
        )}
        <p role="status" className="text-[0.8rem] text-muted">
          {message}
        </p>
      </div>
    </section>
  );
}
