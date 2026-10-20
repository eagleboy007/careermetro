"use client";

import { ArrowRight, Flag, Lock, MessageSquareText, RotateCcw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { countWords } from "@/lib/practice/words";
import type { PracticeAnswerResult, PracticeFeedback, PracticeRateResult, PracticeSkill, PracticeTag, PracticeView as View } from "@/lib/schemas";
import { PRACTICE_CONFIDENCE_WORDS, PRACTICE_DAILY_ANSWERS, PRACTICE_MIN_WORDS } from "@/lib/schemas/constants";
import { ConfidenceSpark, confidenceWord, sessionsText } from "./confidence-spark";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const CARD = "flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[18px] py-4";
const BTN = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-[0.86rem] font-[550]";
const PRIMARY = `${BTN} bg-accent text-on-accent hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;
const GHOST = `${BTN} border border-line-strong bg-surface text-ink hover:bg-surface-2`;

const TAG_TEXT: Record<PracticeTag, string> = { current: "Current goal", ahead: "Goal ahead", met: "Goal met · keep sharp" };

/** "7 of 10 answers left today" for the chip at the top; Elite has no daily cap (FR-50), shown as `left` null. */
export const leftText = (left: number | null) => (left === null ? "No daily cap with Elite" : `${left} of ${PRACTICE_DAILY_ANSWERS} answers left today`);
/** Whether "Get feedback" can be pressed: enough words and answers left today (always, on Elite). */
export const canSend = (words: number, left: number | null) => words >= PRACTICE_MIN_WORDS && (left === null || left > 0);

/** What the side card says about the person's trend for the skill picked. */
export function trendSummary(ratings: number[]): string {
  if (ratings.length === 0) return "";
  return `Last ${sessionsText(ratings.length)}: from "${confidenceWord(ratings[0])}" to "${confidenceWord(ratings[ratings.length - 1])}". Your own rating, not a score.`;
}

type Phase = { kind: "write" } | { kind: "sending" } | { kind: "feedback"; answerId: string | null; feedback: PracticeFeedback; rated: number | null } | { kind: "saved" };

/**
 * Practice (handoff 12h, prototype v37): pick one of your goals, answer one of its 5 bank questions, get feedback in
 * words (structure, specificity, correctness) and a stronger sample, then say how sure you feel. No score anywhere,
 * and nothing here fills a goal or moves the train. Without `onSubmit` (example data) nothing is saved and the
 * feedback shown is `sampleFeedback`.
 */
export function PracticeView({
  view,
  onSubmit,
  onRate,
  sampleFeedback,
  initial,
}: {
  view: View;
  onSubmit?: (questionId: string, answer: string) => Promise<PracticeAnswerResult>;
  onRate?: (answerId: string, confidence: number) => Promise<PracticeRateResult>;
  sampleFeedback?: PracticeFeedback;
  /** For /design: open on the feedback card with this answer. */
  initial?: { answer: string; feedback: PracticeFeedback };
}) {
  const id = useId();
  const start = Math.max(0, view.skills.findIndex((s) => s.tag === "current"));
  const [skillAt, setSkillAt] = useState(start);
  const [questionAt, setQuestionAt] = useState(0);
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [phase, setPhase] = useState<Phase>(initial ? { kind: "feedback", answerId: null, feedback: initial.feedback, rated: null } : { kind: "write" });
  const [left, setLeft] = useState(view.left);
  const [message, setMessage] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number[]>>(() => Object.fromEntries(view.skills.map((s) => [s.skillId, s.ratings])));
  // Focus moves after a press only, never on load: to the feedback (or the saved note) once it is in, and to the new
  // question after Next, Skip or a new skill.
  const [focusTick, setFocusTick] = useState(0);
  const focusTarget = useRef<"result" | "question">("result");
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTick === 0) return;
    (focusTarget.current === "result" ? resultHeading : questionHeading).current?.focus();
  }, [focusTick]);
  const moveFocus = (to: "result" | "question") => {
    focusTarget.current = to;
    setFocusTick((n) => n + 1);
  };

  if (view.skills.length === 0) return <NoSkills id={id} noQuestions={view.noQuestions} />;

  const skill: PracticeSkill = view.skills[Math.min(skillAt, view.skills.length - 1)];
  const question = skill.questions[questionAt % skill.questions.length];
  const words = countWords(answer);
  const sendable = phase.kind === "write" && canSend(words, left);
  const mine = ratings[skill.skillId] ?? [];

  const reset = (nextQuestion: number) => {
    setQuestionAt(nextQuestion);
    setAnswer("");
    setPhase({ kind: "write" });
    setMessage(null);
    moveFocus("question");
  };
  const pickSkill = (i: number) => {
    setSkillAt(i);
    reset(0);
  };

  const send = async () => {
    if (!sendable) return;
    setMessage(null);
    if (!onSubmit) {
      // Example data: nothing is saved.
      if (sampleFeedback) {
        setPhase({ kind: "feedback", answerId: null, feedback: sampleFeedback, rated: null });
        setLeft((n) => (n === null ? null : Math.max(0, n - 1)));
      } else setPhase({ kind: "saved" });
      moveFocus("result");
      return;
    }
    setPhase({ kind: "sending" });
    let result: PracticeAnswerResult;
    try {
      result = await onSubmit(question.id, answer);
    } catch {
      result = { ok: false, message: "Something went wrong sending that. Your answer is still here; try again." };
    }
    if (!result.ok) {
      setPhase({ kind: "write" });
      setMessage(result.message);
      if (result.left !== undefined) setLeft(result.left);
      return;
    }
    setLeft(result.left);
    setPhase(result.feedback ? { kind: "feedback", answerId: result.answerId, feedback: result.feedback, rated: null } : { kind: "saved" });
    moveFocus("result");
  };

  const rate = async (value: number) => {
    if (phase.kind !== "feedback") return;
    const before = phase.rated;
    if (phase.answerId && onRate) {
      const out = await onRate(phase.answerId, value).catch((): PracticeRateResult => ({ ok: false, message: "That didn't save. Please try again." }));
      if (!out.ok) {
        setMessage(out.message);
        return;
      }
    }
    setMessage(null);
    setPhase({ ...phase, rated: value });
    setRatings((all) => {
      const list = all[skill.skillId] ?? [];
      return { ...all, [skill.skillId]: before === null ? [...list, value] : [...list.slice(0, -1), value] };
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">Practice</h1>
          <p className="mt-1.5 max-w-[62ch] text-[0.92rem] text-muted">
            Interview questions on your goals. Write an answer, get feedback in words and a stronger sample. No scores, and practice never fills a goal.
          </p>
        </div>
        <p role="status" className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[0.8rem] text-ink">
          <MessageSquareText size={14} {...ICON} />
          {leftText(left)}
        </p>
      </div>

      <section aria-labelledby={`${id}-pick`} className={CARD}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={`${id}-pick`} className="font-sans text-[1.05rem] font-semibold">
            Pick a skill
          </h2>
          <span className={LABEL}>your goals · 5 questions each</span>
        </div>
        <div role="group" aria-labelledby={`${id}-pick`} className="flex gap-2 overflow-x-auto p-0.5 min-[760px]:flex-wrap">
          {view.skills.map((s, i) => (
            <button
              key={s.skillId}
              type="button"
              aria-pressed={s.skillId === skill.skillId}
              onClick={() => pickSkill(i)}
              className="flex min-w-[128px] flex-none flex-col items-start gap-0.5 rounded-md border border-line-strong bg-surface px-3 py-2 text-left text-ink hover:border-ink aria-pressed:border-ink aria-pressed:bg-surface-2 aria-pressed:shadow-[inset_0_0_0_1px_var(--ink)]"
            >
              <b className="text-[0.9rem] font-semibold">{s.name}</b>
              <small className="text-[0.72rem] text-muted">
                {TAG_TEXT[s.tag]} · {s.questions.length} questions
              </small>
            </button>
          ))}
        </div>
        {view.noQuestions.length > 0 && <p className="text-[0.8rem] text-muted">No questions yet for {listText(view.noQuestions)}. More skills come as the question bank grows.</p>}
      </section>

      <div className="grid items-start gap-4 min-[860px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby={`${id}-q`} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={LABEL}>
                Question {(questionAt % skill.questions.length) + 1} of {skill.questions.length} · {skill.name}
              </span>
              <span className="ml-auto text-[0.74rem] text-muted">From the question bank, not written by AI</span>
            </div>
            <h2 id={`${id}-q`} ref={questionHeading} tabIndex={-1} className="text-[clamp(1.12rem,2.6vw,1.3rem)] font-semibold leading-tight tracking-[-0.015em] focus-visible:outline-2 focus-visible:outline-accent">
              {question.question}
            </h2>
            <p className="-mt-1.5 text-[0.84rem] text-muted">Interviewers look for: {question.lookFor}</p>
            <label htmlFor={`${id}-answer`} className="sr-only">
              Your answer
            </label>
            <textarea
              id={`${id}-answer`}
              rows={7}
              value={answer}
              readOnly={phase.kind !== "write"}
              onChange={(e) => setAnswer(e.target.value)}
              aria-describedby={`${id}-count ${id}-privacy`}
              placeholder="Write it the way you would say it in an interview."
              className="min-h-[150px] w-full resize-y rounded-md border border-line-strong bg-bg px-3.5 py-3 text-[0.95rem] leading-normal text-ink placeholder:text-muted focus:border-ink read-only:bg-surface-2"
            />
            <div className="flex flex-wrap items-center gap-2.5">
              {phase.kind === "write" || phase.kind === "sending" ? (
                <>
                  <button type="button" onClick={send} aria-disabled={!sendable} className={PRIMARY}>
                    {phase.kind === "sending" ? "Getting feedback…" : "Get feedback"}
                  </button>
                  <button type="button" onClick={() => reset(questionAt + 1)} className={GHOST}>
                    <SkipForward size={16} {...ICON} />
                    Skip question
                  </button>
                </>
              ) : null}
              <span id={`${id}-count`} className="font-mono text-[0.72rem] text-muted min-[560px]:ml-auto">
                {words} {words === 1 ? "word" : "words"}
                {phase.kind === "write" && words < PRACTICE_MIN_WORDS ? ` · at least ${PRACTICE_MIN_WORDS} for feedback` : ""}
                {phase.kind === "write" && left === 0 ? " · no answers left today" : ""}
              </span>
            </div>
            {message && (
              <p role="alert" className="text-[0.84rem] text-ink">
                {message}
              </p>
            )}
            <p id={`${id}-privacy`} className="flex items-start gap-1.5 text-[0.78rem] text-muted">
              <Lock size={13} className="mt-0.5 shrink-0" {...ICON} />
              Only you see your answers. We keep them 30 days, and they&apos;re in your data download.
            </p>
          </section>

          {phase.kind === "saved" && (
            <section aria-labelledby={`${id}-saved`} className={CARD}>
              <h2 id={`${id}-saved`} ref={resultHeading} tabIndex={-1} className="font-sans text-[1.05rem] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
                Feedback isn&apos;t available right now
              </h2>
              <p className="text-[0.88rem]">Your answer is saved, and it didn&apos;t use one of today&apos;s answers. Try again in a few minutes.</p>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" onClick={() => setPhase({ kind: "write" })} className={GHOST}>
                  <RotateCcw size={16} {...ICON} />
                  Try again
                </button>
                <button type="button" onClick={() => reset(questionAt + 1)} className={GHOST}>
                  Next question
                </button>
              </div>
            </section>
          )}

          {phase.kind === "feedback" && (
            <section aria-labelledby={`${id}-fb`} className={CARD}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id={`${id}-fb`} ref={resultHeading} tabIndex={-1} className="font-sans text-[1.05rem] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
                  Feedback
                </h2>
                <span className={LABEL}>in words, no score</span>
              </div>
              <FeedbackRows feedback={phase.feedback} />
              <div className="flex flex-col gap-2 rounded-md bg-surface-2 px-4 py-3.5">
                <h3 className={LABEL}>A stronger answer</h3>
                <blockquote className="border-l-2 border-ink pl-3 text-[0.92rem] leading-relaxed">{phase.feedback.strongerAnswer}</blockquote>
                <p className="text-[0.78rem] text-muted">A sample to learn from, not a script. Use your own work where you can.</p>
              </div>
              <div className="flex flex-col gap-2">
                <h3 id={`${id}-rate`} className="font-sans text-[0.92rem] font-semibold">
                  How sure do you feel about this now?
                </h3>
                <div role="group" aria-labelledby={`${id}-rate`} className="flex flex-wrap gap-2">
                  {PRACTICE_CONFIDENCE_WORDS.map((word, i) => (
                    <button
                      key={word}
                      type="button"
                      aria-pressed={phase.rated === i + 1}
                      onClick={() => rate(i + 1)}
                      className="min-h-11 rounded-full border border-line-strong bg-surface px-3.5 text-[0.84rem] font-[550] text-muted hover:text-ink aria-pressed:border-ink aria-pressed:bg-surface-2 aria-pressed:text-ink"
                    >
                      {word}
                    </button>
                  ))}
                </div>
                <p className="text-[0.78rem] text-muted">Your own rating builds your confidence trend on your profile. Only you see it.</p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <button type="button" onClick={() => reset(questionAt + 1)} className={PRIMARY}>
                  Next question
                  <ArrowRight size={16} {...ICON} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPhase({ kind: "write" });
                    moveFocus("question");
                  }}
                  className={GHOST}
                >
                  Try this one again
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Your confidence and how practice counts">
          <section aria-labelledby={`${id}-conf`} className={CARD}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`${id}-conf`} className="font-sans text-[1.05rem] font-semibold">
                Your confidence
              </h2>
              <span className={LABEL}>{skill.name}</span>
            </div>
            {mine.length ? (
              <>
                <ConfidenceSpark ratings={mine} width={260} height={70} />
                <p className="text-[0.78rem] text-muted">{trendSummary(mine)}</p>
              </>
            ) : (
              <p className="text-[0.78rem] text-muted">No ratings yet. Rate how sure you feel after an answer and your trend starts here.</p>
            )}
            <Link href="/me" className="inline-flex min-h-11 items-center gap-1 self-start text-[0.84rem] font-[550] text-ink underline-offset-2 hover:underline">
              See all on your profile
              <ArrowRight size={15} {...ICON} />
            </Link>
          </section>
          <section aria-label="How practice counts" className="flex items-start gap-3 rounded-lg bg-surface-2 px-[18px] py-4">
            <Flag size={18} className="mt-0.5 shrink-0" {...ICON} />
            {skill.tag === "met" ? (
              <p className="text-[0.86rem] leading-snug">
                <b className="font-semibold">This goal is already proved.</b> Practice keeps it sharp for interviews and doesn&apos;t change anything on your line.
              </p>
            ) : (
              <p className="text-[0.86rem] leading-snug">
                <b className="font-semibold">Practice gets you ready. Proof fills the goal.</b> For {skill.name}, that&apos;s its prove pitstop: a skill check, a
                certification or work someone confirms.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** "A", "A and B", "A, B and C". */
export function listText(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Structure, Specificity and Correctness, in the model's words. */
export function FeedbackRows({ feedback }: { feedback: PracticeFeedback }) {
  const rows: [string, string][] = [
    ["Structure", feedback.structure],
    ["Specificity", feedback.specificity],
    ["Correctness", feedback.correctness],
  ];
  return (
    <dl className="flex flex-col">
      {rows.map(([name, text], i) => (
        <div key={name} className={`grid gap-x-3.5 gap-y-1 py-2.5 text-[0.9rem] leading-snug min-[560px]:grid-cols-[110px_minmax(0,1fr)] ${i ? "border-t border-line" : "pt-0"}`}>
          <dt className={`${LABEL} pt-0.5`}>{name}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** No goal with bank questions yet: say why, and where to go instead. */
function NoSkills({ id, noQuestions }: { id: string; noQuestions: string[] }) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">Practice</h1>
      <section aria-labelledby={`${id}-none`} className="mx-auto flex max-w-[520px] flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-10 text-center">
        <MessageSquareText size={30} className="text-muted" {...ICON} />
        <h2 id={`${id}-none`} className="text-[1.25rem] font-semibold">
          No practice questions for your goals yet
        </h2>
        <p className="text-[0.9rem] leading-normal text-muted">
          {noQuestions.length
            ? `The question bank doesn't cover ${listText(noQuestions)} yet. It grows skill by skill.`
            : "Add your resume and pick a role. Practice questions come from the goals on your line."}
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {noQuestions.length === 0 && (
            <Link href="/today" className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-on-accent hover:opacity-90">
              Add your resume
            </Link>
          )}
          <Link href="/map" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-ink hover:bg-surface-2">
            See your line
          </Link>
        </div>
      </section>
    </div>
  );
}
