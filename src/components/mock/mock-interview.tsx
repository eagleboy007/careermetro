"use client";

import { ArrowRight, Briefcase, Clock, Flag, Info, Lock, MessageSquareText, Mic, Play, Square } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { jobRoundText, MOCK_FEEDBACK_TEXT } from "@/lib/mock/interview";
import { countWords } from "@/lib/practice/words";
import type {
  JobPrepView,
  MockFocus,
  MockFollowUpAnswerResult,
  MockFollowUpAsked,
  MockFollowUpState,
  MockInterviewAnswerResult,
  MockInterviewEndResult,
  MockInterviewStartResult,
  MockLength,
  MockRole,
  MockSessionResult,
  MockSessionView,
  MyJobRef,
} from "@/lib/schemas";
import { MOCK_ANSWER_MAX_CHARS, MOCK_FOCUSES, MOCK_FOLLOW_UP_MIN_WORDS, MOCK_LENGTH_MINUTES, MOCK_LENGTH_QUESTIONS, MOCK_LENGTHS } from "@/lib/schemas/constants";
import { listen, localLanguage, onDeviceRecognition, withSpoken } from "./speech";
import { clockText } from "./timed-test";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const CARD = "flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[18px] py-4";
const BTN = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-[0.86rem] font-[550] aria-disabled:cursor-wait aria-disabled:opacity-60";
const INK = `${BTN} bg-ink text-bg hover:opacity-90`;
const GHOST = `${BTN} border border-line-strong bg-surface text-ink hover:bg-surface-2`;
const PICKED = "has-[:checked]:border-ink has-[:checked]:shadow-[inset_0_0_0_1px_var(--ink)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent";
const CHOICE = `flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 py-2 text-[0.88rem] text-ink ${PICKED}`;
const LENGTH_CHOICE = `flex min-h-11 min-w-[170px] cursor-pointer flex-col items-start gap-0.5 rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-[0.88rem] text-ink ${PICKED}`;

const LENGTH_TEXT: Record<MockLength, string> = { quick: "Quick round", full: "Full round" };
const FOCUS_TEXT: Record<MockFocus, string> = { mix: "Mix", gaps: "Your gaps", technical: "Technical", about: "About you", job: "This job's skills" };
const FAILED = "That didn't work. Please try again.";
const NOT_SAVED = "That answer didn't save. It goes with the round when you end it.";

/**
 * The set-up note on who asks what. A role whose rounds can ask follow-ups says so; the prototype's line, which says
 * the bank was checked by people who work in the role, shows only once its follow-ups are checked.
 */
export const SETUP_NOTE: Record<MockFollowUpState, string> = {
  none: "The interviewer is an AI and it can be wrong. The questions come from CareerMetro's question bank, not from AI. We keep the text of your answers 30 days.",
  draft:
    "The interviewer is an AI. It asks follow-ups like a person would, and it can be wrong. The questions and follow-ups come from CareerMetro's question bank, not from AI. We keep the text of your answers 30 days.",
  checked:
    "The interviewer is an AI. It asks follow-ups like a person would, and it can be wrong. Questions come from a bank checked by people who work in the role. We keep the text of your answers 30 days.",
};

/** "10 min · 4 questions" under each length. */
export const lengthNote = (length: MockLength) => `${MOCK_LENGTH_MINUTES[length]} min · ${MOCK_LENGTH_QUESTIONS[length]} questions`;
/** "2 of 4 answered": how much of the round was answered, never a score. */
export const answeredText = (answered: number, total: number) => `${answered} of ${total} answered`;
/** An answer shown back on the feedback screen, cut at 220 characters. */
export const shortAnswer = (answer: string) => (answer.length > 220 ? `${answer.slice(0, 220).trimEnd()}…` : answer);
/** The positions (1-based) whose text differs from what the server has, to send with "End and get feedback". */
export function unsaved(drafts: readonly string[], saved: readonly string[]): { position: number; answer: string }[] {
  return drafts.flatMap((d, i) => (d.trim() !== (saved[i] ?? "") ? [{ position: i + 1, answer: d.trim() }] : []));
}
/**
 * Follow-up replies to send with "End and get feedback": those not yet saved, and the open follow-up's draft (an empty
 * draft is a skip). One per position, the open draft last so it wins.
 */
export function unsavedFollowUps(pending: ReadonlyMap<number, string>, open: { position: number } | null, draft: string): { position: number; answer: string }[] {
  const all = new Map(pending);
  if (open && draft.trim()) all.set(open.position, draft.trim());
  return [...all].map(([position, answer]) => ({ position, answer }));
}
/** Whether "Next" waits for the server, which may ask a follow-up: only for a changed answer of 20 words or more. */
export const mayFollowUp = (text: string, saved: string): boolean => text !== saved && countWords(text) >= MOCK_FOLLOW_UP_MIN_WORDS;

const noSubscribe = () => () => {};

type Phase = { kind: "setup" } | { kind: "running"; session: MockSessionView } | { kind: "result"; result: MockSessionResult };

/**
 * The mock interview tab of /mock (handoff 12l, prototype v44): set up a round (role, Quick or Full, focus), answer
 * bank questions one at a time against a countdown, then "End and get feedback": a summary in words and, per question,
 * "What worked" and "Add next time"; skipped questions link to the bank. No score anywhere. The interviewer is an AI
 * and can be wrong; it never writes the questions. Answers are typed, or spoken where the browser can turn speech to
 * text on the device (the audio never leaves it). Each answer is saved on Next; the server refuses answers once the
 * round has ended. After a long answer the server may ask one follow-up from the bank (picked by code): it opens in
 * the interviewer's row with a fresh answer box and "Skip follow-up"; the progress bar and the question count stay,
 * and the clock keeps running. Cobalt is only the progress bar. Without actions (example data) nothing is saved.
 * Set up for one job in My jobs (`job`, handoff 12m): "Practise for <company>, <title>", a banner on what it asks
 * first, no role picker, and "This job's skills" picked; the round and its feedback carry the job's name.
 */
export function MockInterview({
  elite,
  roles,
  roleSlug,
  initial,
  job: forJob = null,
  initialResult,
  initialFollowUp,
  onStart,
  onAnswer,
  onFollowUp,
  onEnd,
}: {
  elite: boolean;
  roles: readonly MockRole[];
  roleSlug: string;
  initial: MockSessionView | null;
  /** `/mock?job=`: the job in My jobs to set the round up for. */
  job?: JobPrepView | null;
  /** For /design: open on a feedback screen. */
  initialResult?: MockSessionResult;
  /** For /design: the running round opens on this follow-up. */
  initialFollowUp?: MockFollowUpAsked | null;
  onStart?: (roleSlug: string, length: MockLength, focus: MockFocus, job?: MyJobRef) => Promise<MockInterviewStartResult>;
  onAnswer?: (sessionId: string, position: number, answer: string) => Promise<MockInterviewAnswerResult>;
  onFollowUp?: (sessionId: string, position: number, answer: string) => Promise<MockFollowUpAnswerResult>;
  onEnd?: (sessionId: string, answers: { position: number; answer: string }[], followUps: { position: number; answer: string }[]) => Promise<MockInterviewEndResult>;
}) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>(initialResult ? { kind: "result", result: initialResult } : initial ? { kind: "running", session: initial } : { kind: "setup" });
  const [role, setRole] = useState(roleSlug);
  const [length, setLength] = useState<MockLength>("quick");
  // "Practise for the role instead" lets go of the job.
  const [job, setJob] = useState<JobPrepView | null>(forJob);
  const [focus, setFocus] = useState<MockFocus>(forJob ? "job" : "mix");
  const [speaking, setSpeaking] = useState(false);
  const [at, setAt] = useState(() => (initial && initialFollowUp ? initialFollowUp.position - 1 : initial ? Math.max(0, initial.answers.findIndex((a) => a === "")) : 0));
  const [drafts, setDrafts] = useState<string[]>(initial?.answers ?? []);
  const saved = useRef<string[]>(initial?.answers ?? []);
  const [left, setLeft] = useState(initial?.secondsLeft ?? 0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const deadline = useRef<number | null>(null);
  const ending = useRef(false);
  const timedOut = useRef(false);
  // The latest drafts, for "End and get feedback" when the clock runs out; written with the state, never in render.
  const draftsRef = useRef<string[]>(initial?.answers ?? []);
  const changeDrafts = (change: (all: string[]) => string[]) => {
    const nextDrafts = change(draftsRef.current);
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  };
  // The open follow-up and its draft, with refs for the clock running out; replies not yet saved go with the end.
  const [follow, setFollow] = useState<MockFollowUpAsked | null>(initial ? (initialFollowUp ?? null) : null);
  const followRef = useRef<MockFollowUpAsked | null>(initial ? (initialFollowUp ?? null) : null);
  const [followDraft, setFollowDraft] = useState("");
  const followDraftRef = useRef("");
  const pendingFollowUps = useRef(new Map<number, string>());
  const changeFollowDraft = (change: (draft: string) => string) => {
    const nextDraft = change(followDraftRef.current);
    followDraftRef.current = nextDraft;
    setFollowDraft(nextDraft);
  };
  const openFollowUp = (f: MockFollowUpAsked | null) => {
    followRef.current = f;
    setFollow(f);
    followDraftRef.current = "";
    setFollowDraft("");
  };
  // Set once the feedback is in, so a late save or the clock can't end the round twice.
  const finished = useRef(false);

  // Speaking is offered only where the browser recognises speech on the device.
  const canSpeak = useSyncExternalStore(
    noSubscribe,
    () => onDeviceRecognition() !== null,
    () => false,
  );

  // Focus moves after a press only: to the question after Start or Next, and to the feedback once it is in.
  const [focusTick, setFocusTick] = useState(0);
  const focusTarget = useRef<"question" | "result">("question");
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTick === 0) return;
    (focusTarget.current === "question" ? questionHeading : resultHeading).current?.focus();
  }, [focusTick]);
  const moveFocus = (to: "question" | "result") => {
    focusTarget.current = to;
    setFocusTick((n) => n + 1);
  };

  const sessionId = phase.kind === "running" ? phase.session.id : null;

  const halt = () => {
    stopListening.current?.();
    stopListening.current = null;
  };

  const end = useCallback(async () => {
    if (!sessionId || ending.current || finished.current) return;
    if (!onEnd) {
      setMessage("Example data: sign in to get feedback.");
      return;
    }
    stopListening.current?.();
    stopListening.current = null;
    ending.current = true;
    setBusy(true);
    setMessage("Getting your feedback. This can take half a minute.");
    const followUps = unsavedFollowUps(pendingFollowUps.current, followRef.current, followDraftRef.current);
    const out = await onEnd(sessionId, unsaved(draftsRef.current, saved.current), followUps).catch((): MockInterviewEndResult => ({ ok: false, message: FAILED }));
    ending.current = false;
    setBusy(false);
    if (!out.ok) {
      setMessage(out.message);
      return;
    }
    finished.current = true;
    pendingFollowUps.current.clear();
    followRef.current = null;
    setFollow(null);
    setMessage(null);
    deadline.current = null;
    setPhase({ kind: "result", result: out.result });
    focusTarget.current = "result";
    setFocusTick((n) => n + 1);
  }, [onEnd, sessionId]);

  // The clock counts down to the deadline, not by ticks, so a slow tab can't stretch it; at 0 the round ends.
  useEffect(() => {
    if (phase.kind !== "running" || !onEnd) return;
    if (deadline.current === null) deadline.current = Date.now() + phase.session.secondsLeft * 1000;
    const timer = setInterval(() => {
      const s = Math.max(0, Math.ceil((deadline.current! - Date.now()) / 1000));
      setLeft(s);
      if (s === 0 && !timedOut.current) {
        timedOut.current = true;
        void end();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, onEnd, end]);

  // Listening stops when the tab leaves the page.
  useEffect(() => () => stopListening.current?.(), []);

  const start = async () => {
    if (busy) return;
    if (!onStart) {
      setMessage("Example data: sign in to start a mock interview.");
      return;
    }
    setBusy(true);
    const out = await (focus === "job" && job ? onStart(role, length, focus, job.ref) : onStart(role, length, focus === "job" ? "mix" : focus)).catch(
      (): MockInterviewStartResult => ({ ok: false, message: FAILED }),
    );
    setBusy(false);
    if (!out.ok) {
      setMessage(out.message);
      return;
    }
    setMessage(null);
    deadline.current = null;
    timedOut.current = false;
    finished.current = false;
    pendingFollowUps.current.clear();
    openFollowUp(null);
    saved.current = out.session.answers;
    draftsRef.current = out.session.answers;
    setDrafts(out.session.answers);
    setAt(0);
    setLeft(out.session.secondsLeft);
    setPhase({ kind: "running", session: out.session });
    moveFocus("question");
  };

  if (!elite) {
    return (
      <section aria-labelledby={`${id}-h`} className={CARD}>
        <h2 id={`${id}-h`} className="font-sans text-[1.05rem] font-semibold">
          Mock interview
        </h2>
        <p className="flex items-start gap-2 text-[0.86rem] text-muted">
          <Lock size={16} {...ICON} className="mt-0.5 shrink-0" />A quick or full round of questions for your role, then feedback in words on each answer, never a
          score. Mock interviews open with Elite.
        </p>
      </section>
    );
  }

  if (phase.kind === "result") {
    const r = phase.result;
    const bankHref = r.items[0]?.bankHref ?? "/mock?tab=bank";
    return (
      <section aria-labelledby={`${id}-fh`} className="flex min-w-0 flex-col gap-3.5">
        <div className={CARD}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`${id}-fh`} ref={resultHeading} tabIndex={-1} className="mr-auto font-sans text-[1.05rem] font-semibold focus-visible:outline-2 focus-visible:outline-accent">
              {r.job ? `Feedback on your round for ${r.job.company}` : "Feedback on your round"}
            </h2>
            <span className={LABEL}>
              {r.roleTitle} · {answeredText(r.answered, r.total)}
            </span>
          </div>
          {r.feedback === "ready" && r.summary ? (
            <p className="text-[0.95rem] leading-relaxed">{r.summary}</p>
          ) : (
            <p className="text-[0.9rem] text-muted">{MOCK_FEEDBACK_TEXT[r.feedback === "ready" ? "unavailable" : r.feedback]}</p>
          )}
          <p className="text-[0.78rem] text-muted">Feedback from an AI interviewer, which can be wrong. It never scores you.</p>
        </div>
        <ol className="flex flex-col gap-3">
          {r.items.map((q) => (
            <li key={q.position} data-feedback-item={q.answer ? "answered" : "skipped"} className={CARD}>
              <span className={LABEL}>
                {q.position} · {q.topic}
              </span>
              <b className="text-[0.95rem] font-[550]">{q.question}</b>
              {q.answer ? (
                <>
                  <blockquote className="border-l-2 border-line pl-3 text-[0.86rem] text-muted">{shortAnswer(q.answer)}</blockquote>
                  {q.followUp && (
                    <div data-follow-up={q.followUp.answer ? "answered" : "skipped"} className="flex flex-col gap-1.5">
                      <span className={LABEL}>Follow-up</span>
                      <b className="text-[0.9rem] font-[550]">{q.followUp.question}</b>
                      {q.followUp.answer ? (
                        <blockquote className="border-l-2 border-line pl-3 text-[0.86rem] text-muted">{shortAnswer(q.followUp.answer)}</blockquote>
                      ) : (
                        <p className="text-[0.86rem] text-muted">Follow-up skipped.</p>
                      )}
                    </div>
                  )}
                  {q.whatWorked && q.addNextTime && (
                    <dl className="grid gap-x-3.5 gap-y-2 text-[0.9rem] sm:grid-cols-[120px_minmax(0,1fr)]">
                      <dt className={`${LABEL} pt-[3px]`}>What worked</dt>
                      <dd>{q.whatWorked}</dd>
                      <dt className={`${LABEL} border-t border-line pt-2.5 sm:pt-[13px]`}>Add next time</dt>
                      <dd className="sm:border-t sm:border-line sm:pt-2.5">{q.addNextTime}</dd>
                    </dl>
                  )}
                </>
              ) : (
                <p className="text-[0.86rem] text-muted">
                  Skipped.{" "}
                  <Link href={q.bankHref} className="text-ink underline underline-offset-2">
                    Open it in the bank
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ol>
        <div className="flex items-start gap-3 rounded-lg bg-surface-2 px-[18px] py-3.5 text-[0.86rem]">
          <Flag size={18} {...ICON} className="mt-0.5 shrink-0" />
          <p>
            <b className="font-semibold">Practice gets you ready. Proof fills the goal.</b> Mock interviews never change your gaps.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: "setup" });
              setMessage(null);
            }}
            className={INK}
          >
            <Play size={16} {...ICON} />
            Another round
          </button>
          <Link href={bankHref} className={GHOST}>
            Study these in the bank
            <ArrowRight size={15} {...ICON} />
          </Link>
        </div>
      </section>
    );
  }

  if (phase.kind === "setup") {
    return (
      <section aria-labelledby={`${id}-sh`} className={CARD}>
        <h2 id={`${id}-sh`} className="font-sans text-[1.05rem] font-semibold [overflow-wrap:anywhere]">
          {job ? `Practise for ${job.company}, ${job.title}` : "Set up your mock interview"}
        </h2>
        {job ? (
          <div data-job-round className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-bg px-4 py-3 text-[0.86rem]">
            <Briefcase size={18} {...ICON} className="shrink-0 text-ink" />
            <span className="min-w-[200px] flex-1 [overflow-wrap:anywhere]">
              <b className="font-semibold">
                For one job: {job.company}, {job.title}.
              </b>{" "}
              {jobRoundText(job)}
            </span>
            <button
              type="button"
              onClick={() => {
                setJob(null);
                setFocus("mix");
              }}
              className="inline-flex min-h-11 items-center rounded-full px-3 text-[0.82rem] font-[550] text-ink hover:bg-surface-2"
            >
              Practise for the role instead
            </button>
          </div>
        ) : (
          <label htmlFor={`${id}-role`} className="flex flex-col gap-1 text-[0.78rem] text-muted">
            Role
            <select
              id={`${id}-role`}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="min-h-11 max-w-[360px] rounded-md border border-line-strong bg-surface px-3 text-[0.88rem] text-ink"
            >
              {roles.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[0.78rem] text-muted">Length</legend>
          <div className="flex flex-wrap gap-2.5">
            {MOCK_LENGTHS.map((l) => (
              <label key={l} className={LENGTH_CHOICE}>
                <input type="radio" name={`${id}-length`} value={l} checked={length === l} onChange={() => setLength(l)} className="sr-only" />
                <b className="font-[600]">{LENGTH_TEXT[l]}</b>
                <span className="text-[0.76rem] text-muted">{lengthNote(l)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[0.78rem] text-muted">Focus</legend>
          <div className="flex flex-wrap gap-2">
            {(job ? (["job", ...MOCK_FOCUSES.filter((f) => f !== "job")] as MockFocus[]) : MOCK_FOCUSES.filter((f) => f !== "job")).map((f) => (
              <label key={f} className={CHOICE}>
                <input type="radio" name={`${id}-focus`} value={f} checked={focus === f} onChange={() => setFocus(f)} className="sr-only" />
                {FOCUS_TEXT[f]}
              </label>
            ))}
          </div>
        </fieldset>
        {canSpeak && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[0.78rem] text-muted">Answer by</legend>
            <div className="flex flex-wrap gap-2">
              <label className={CHOICE}>
                <input type="radio" name={`${id}-by`} checked={!speaking} onChange={() => setSpeaking(false)} className="sr-only" />
                Typing
              </label>
              <label className={CHOICE}>
                <input type="radio" name={`${id}-by`} checked={speaking} onChange={() => setSpeaking(true)} className="sr-only" />
                Speaking
              </label>
            </div>
            <small className="text-[0.76rem] text-muted">
              Speaking needs your microphone. We keep the text of your answers 30 days and never the audio. After that only the round&apos;s short
              feedback summary stays, and it can mention what you said. Your browser turns speech into text on this device, and you can edit the text
              before you move on.
            </small>
          </fieldset>
        )}
        <p className="flex gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[0.8rem] text-muted">
          <Info size={15} {...ICON} className="mt-px shrink-0" />
          {SETUP_NOTE[roles.find((r) => r.slug === role)?.followUps ?? "none"]}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={start} aria-disabled={busy || undefined} className={INK}>
            <Play size={16} {...ICON} />
            Start mock interview
          </button>
          <p role="status" className="text-[0.8rem] text-muted">
            {message}
          </p>
        </div>
      </section>
    );
  }

  const session = phase.session;
  const total = session.questions.length;
  const q = session.questions[Math.min(at, total - 1)];
  const draft = drafts[at] ?? "";
  const answered = drafts.filter((d) => d.trim()).length;
  const last = at >= total - 1;
  const low = left <= 60;
  const words = countWords(follow ? followDraft : draft);

  const setDraft = (value: string) => changeDrafts((all) => session.questions.map((_, i) => (i === at ? value : (all[i] ?? ""))));

  const save = (position: number, text: string): Promise<MockInterviewAnswerResult | null> => {
    if (!onAnswer || text === (saved.current[position - 1] ?? "")) return Promise.resolve(null);
    return onAnswer(session.id, position, text)
      .catch((): MockInterviewAnswerResult => ({ ok: false, message: NOT_SAVED, over: false }))
      .then((out) => {
        if (out.ok) {
          saved.current = session.questions.map((_, i) => (i === position - 1 ? text : (saved.current[i] ?? "")));
          return out;
        }
        setMessage(out.message);
        if (out.over) void end();
        return out;
      });
  };

  // A reply waits in pendingFollowUps until the server has it, so a failed save still goes with the end.
  const saveFollowUp = (position: number, text: string) => {
    if (!onFollowUp) return;
    pendingFollowUps.current.set(position, text);
    void onFollowUp(session.id, position, text)
      .catch((): MockFollowUpAnswerResult => ({ ok: false, message: NOT_SAVED, over: false }))
      .then((out) => {
        if (out.ok) {
          if (pendingFollowUps.current.get(position) === text) pendingFollowUps.current.delete(position);
          return;
        }
        setMessage(out.message);
        if (out.over) void end();
      });
  };

  // On to the next question, or the end after the last. `keepMessage` keeps a save error on screen.
  const advance = (keepMessage = false) => {
    if (last) {
      void end();
      return;
    }
    setAt(at + 1);
    if (!keepMessage) setMessage(null);
    moveFocus("question");
  };

  const next = async () => {
    if (busy) return;
    halt();
    setListening(false);
    if (follow) {
      const reply = followDraft.trim();
      if (reply) saveFollowUp(follow.position, reply);
      openFollowUp(null);
      advance();
      return;
    }
    const position = at + 1;
    const text = draft.trim();
    if (!onAnswer || !mayFollowUp(text, saved.current[position - 1] ?? "")) {
      void save(position, text);
      advance();
      return;
    }
    // A long answer waits for the server, which may ask one follow-up before the next question.
    setBusy(true);
    const out = await save(position, text);
    setBusy(false);
    if (out && !out.ok && out.over) return;
    if (out?.ok && out.followUp && !finished.current) {
      openFollowUp(out.followUp);
      setMessage(null);
      moveFocus("question");
      return;
    }
    advance(out?.ok === false);
  };

  const skipFollowUp = () => {
    if (busy) return;
    halt();
    setListening(false);
    if (last) {
      // The round ends from here, so the button stays (and keeps focus) until the feedback is in; a skip sends nothing.
      changeFollowDraft(() => "");
      void end();
      return;
    }
    openFollowUp(null);
    advance();
  };

  const toggleSpeech = async () => {
    if (listening) {
      halt();
      setListening(false);
      return;
    }
    const C = onDeviceRecognition();
    const lang = C ? await localLanguage(C) : null;
    if (!C || !lang) {
      setMessage("Speaking isn't available on this device. Typing works everywhere.");
      return;
    }
    const position = at;
    const intoFollowUp = followRef.current !== null;
    setMessage(null);
    setListening(true);
    try {
      stopListening.current = listen(
        C,
        lang,
        (text) =>
          intoFollowUp
            ? changeFollowDraft((d) => withSpoken(d, text, MOCK_ANSWER_MAX_CHARS))
            : changeDrafts((all) => session.questions.map((_, i) => (i === position ? withSpoken(all[i] ?? "", text, MOCK_ANSWER_MAX_CHARS) : (all[i] ?? "")))),
        (error) => {
          stopListening.current = null;
          setListening(false);
          if (error && error !== "aborted" && error !== "no-speech") setMessage("Listening stopped. You can type, or press Speak again.");
        },
      );
    } catch {
      setListening(false);
      setMessage("Speaking isn't available on this device. Typing works everywhere.");
    }
  };

  return (
    <section aria-labelledby={`${id}-q`} className={CARD}>
      {session.job && (
        <p className={`${LABEL} flex items-center gap-1.5 [overflow-wrap:anywhere]`}>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ink" />
          Mock interview for {session.job.company}, {session.job.title}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={`${LABEL} mr-auto`}>
          Question {at + 1} of {total} · {q.topic}
        </span>
        <span
          role="timer"
          aria-label={`Time left ${clockText(left)}`}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.86rem] ${low ? "bg-ink text-bg" : "bg-surface-2 text-ink"}`}
        >
          <Clock size={14} {...ICON} />
          {clockText(left)}
        </span>
      </div>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(answered / total) * 100}%` }} />
      </div>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-bg">
          <MessageSquareText size={17} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <span className={LABEL}>{follow ? `Follow-up · ${follow.topic}` : "AI interviewer"}</span>
          <h3 id={`${id}-q`} ref={questionHeading} tabIndex={-1} className="mt-0.5 font-display text-[1.25rem] font-semibold leading-snug tracking-[-0.01em] focus-visible:outline-2 focus-visible:outline-accent">
            {follow ? follow.text : q.question}
          </h3>
        </div>
      </div>
      <label htmlFor={`${id}-a`} className="sr-only">
        Your answer
      </label>
      <textarea
        id={`${id}-a`}
        rows={6}
        value={follow ? followDraft : draft}
        maxLength={MOCK_ANSWER_MAX_CHARS}
        onChange={(e) => (follow ? changeFollowDraft(() => e.target.value) : setDraft(e.target.value))}
        placeholder="Answer the way you would out loud. Short is fine."
        className="w-full rounded-md border border-line-strong bg-surface px-3.5 py-3 text-[0.95rem] leading-relaxed text-ink placeholder:text-muted"
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => void next()} aria-disabled={busy || undefined} className={INK}>
          {last ? "Finish" : "Next question"}
        </button>
        {follow && (
          <button type="button" onClick={skipFollowUp} aria-disabled={busy || undefined} className={GHOST}>
            Skip follow-up
          </button>
        )}
        <button type="button" onClick={() => void end()} aria-disabled={busy || undefined} className={GHOST}>
          End and get feedback
        </button>
        {speaking && canSpeak && (
          <button type="button" onClick={() => void toggleSpeech()} aria-pressed={listening} className={GHOST}>
            {listening ? <Square size={15} {...ICON} /> : <Mic size={15} {...ICON} />}
            {listening ? "Stop" : "Speak"}
          </button>
        )}
        <span className="text-[0.78rem] text-muted">{words === 1 ? "1 word" : `${words} words`}</span>
      </div>
      <p role="status" className="text-[0.8rem] text-muted">
        {message}
      </p>
    </section>
  );
}
