"use client";

import { CalendarClock, CalendarPlus, MessageSquareText, Phone, Users, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { CandidateInterviewsView, CompanyInterviewView, InterviewActions, InterviewRecommendation } from "@/lib/corporate/types";
import { FEEDBACK_MAX, FEEDBACK_MIN, INTERVIEW_RECOMMENDATION_LABELS, INTERVIEW_RECOMMENDATIONS, INTERVIEW_ROUND_LABELS, INTERVIEW_STATUS_LABELS } from "@/lib/schemas/constants";
import { monoLabel } from "./job-parts";
import { actionBtn, inkBtn } from "./jobs-panel";
import { ICON } from "./parts";

/*
 * Interviews on the company side (dev/corporate-plan.md build step 6; C7 Interviews): one interview as a card, the
 * drawer's Interviews tab, and an interviewer's feedback form. Feedback is written by people, read by the job team,
 * and never shown to the candidate; nothing here calls the model. Neutral styles: cobalt is for progress and red,
 * amber and green for gap status, so an interview's state is told in words.
 */

type Notice = (text: string, error: boolean) => void;

/** One interview: when, how long, who, its state, the feedback the person may read, and Cancel or the feedback form. */
export function InterviewCard({ iv, actions, onDone, heading }: { iv: CompanyInterviewView; actions?: InterviewActions; onDone: Notice; heading?: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [writing, setWriting] = useState(false);
  const mine = iv.feedback.find((f) => f.mine);
  const live = iv.status === "proposed" || iv.status === "accepted";
  return (
    <article className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5">
      {heading}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <CalendarClock {...ICON} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.92rem] font-semibold">
            {iv.when.slice(0, -7)}, {iv.range}
          </p>
          <p className="text-[0.8rem] text-muted">
            {INTERVIEW_ROUND_LABELS[iv.round]} · {iv.minutes} min · India time
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${live ? "border border-ink/20 bg-surface-2 text-ink" : "bg-surface-2 text-muted"}`}>
          {INTERVIEW_STATUS_LABELS[iv.status]}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-[0.82rem]">
        <Users {...ICON} size={14} className="text-muted" />
        <span className="text-muted">Interviewers:</span>
        <span className="[overflow-wrap:anywhere]">{iv.interviewers.join(", ") || "None left on the team"}</span>
      </p>
      {iv.phoneShared && live && (
        <p className="flex items-center gap-2 text-[0.82rem] text-muted">
          <Phone {...ICON} size={14} />
          The candidate shared a phone for this interview.
        </p>
      )}
      {iv.feedback.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className={monoLabel}>Feedback</h4>
          <ul className="flex flex-col gap-2">
            {iv.feedback.map((f, i) => (
              <li key={i} className="rounded-md bg-surface-2 px-3 py-2 text-[0.84rem]">
                <p className="flex flex-wrap gap-x-2 text-[0.78rem] text-muted">
                  <span className="font-semibold text-ink">{f.mine ? "You" : f.by}</span>
                  <span>{INTERVIEW_RECOMMENDATION_LABELS[f.recommendation]}</span>
                  <span>{formatDay(f.on)}</span>
                </p>
                <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{f.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {iv.canGiveFeedback &&
        (writing ? (
          <FeedbackForm
            interviewId={iv.id}
            initial={mine ? { recommendation: mine.recommendation, text: mine.text } : null}
            save={actions?.feedback}
            onCancel={() => setWriting(false)}
            onSaved={() => {
              setWriting(false);
              onDone("Feedback saved. The job team reads it; the candidate never does.", false);
            }}
          />
        ) : (
          <button type="button" className={`${actionBtn} self-start`} onClick={() => setWriting(true)}>
            <MessageSquareText {...ICON} />
            {mine ? "Change your feedback" : "Write feedback"}
          </button>
        ))}
      {iv.canCancel && (
        <button
          type="button"
          className={`${actionBtn} self-start`}
          disabled={pending}
          aria-label={`Cancel interview on ${iv.when}`}
          onClick={() =>
            start(async () => {
              if (!actions) return onDone("Example interviews. Nothing changes here.", true);
              const problem = await actions.cancel(iv.id);
              onDone(problem ?? `Cancelled the interview on ${iv.when}. The candidate sees it on Arrivals.`, !!problem);
            })
          }
        >
          <X {...ICON} />
          Cancel interview
        </button>
      )}
    </article>
  );
}

/** An interviewer's feedback: a recommendation and their own words. */
export function FeedbackForm({
  interviewId,
  initial,
  save,
  onSaved,
  onCancel,
}: {
  interviewId: string;
  initial: { recommendation: InterviewRecommendation; text: string } | null;
  save?: InterviewActions["feedback"];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | null>(initial?.recommendation ?? null);
  const [text, setText] = useState(initial?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();
  return (
    <form
      className="flex flex-col gap-2.5 rounded-md bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!recommendation) return setError("Pick a recommendation.");
        if (text.trim().length < FEEDBACK_MIN) return setError(`Write at least ${FEEDBACK_MIN} characters about what you saw.`);
        start(async () => {
          if (!save) return setError("Example interviews. Nothing is saved here.");
          const problem = await save(interviewId, recommendation, text);
          if (problem) setError(problem);
          else onSaved();
        });
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[0.82rem] font-semibold">Your recommendation</legend>
        <div className="flex flex-wrap gap-2">
          {INTERVIEW_RECOMMENDATIONS.map((r) => (
            <label key={r} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[0.84rem] ${recommendation === r ? "border-ink bg-surface font-semibold" : "border-line bg-surface"}`}>
              <input type="radio" name={`${ids}-rec`} value={r} checked={recommendation === r} onChange={() => setRecommendation(r)} className="size-4 accent-ink" />
              {INTERVIEW_RECOMMENDATION_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${ids}-text`} className="flex flex-col gap-1.5 text-[0.82rem] font-semibold">
        What you saw
        <span className="text-[0.78rem] font-normal text-muted">In your own words, about the job&apos;s skills. The job team reads it; the candidate never does.</span>
        <textarea
          id={`${ids}-text`}
          rows={4}
          maxLength={FEEDBACK_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="rounded-sm border border-line-strong bg-surface px-3 py-2 text-[0.88rem] font-normal text-ink"
        />
      </label>
      {error && (
        <p role="alert" className="text-[0.84rem] font-medium">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={inkBtn} disabled={pending}>
          Save feedback
        </button>
        <button type="button" className={actionBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The drawer's Interviews tab: the interviews, Ask for times and Schedule for the job team, feedback for interviewers. */
export function InterviewsTab({
  applicationId,
  data,
  actions,
  onChanged,
}: {
  applicationId: string;
  data: CandidateInterviewsView;
  actions?: InterviewActions;
  /** Without it (the /design page) a change is only said in place. */
  onChanged?: (text: string, error: boolean) => void;
}) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<string | null>(null);
  const tell = onChanged ?? ((text: string) => setSaid(text));
  return (
    <div className="flex flex-col gap-3">
      {said && (
        <p role="status" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
          {said}
        </p>
      )}
      {data.canSchedule && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 px-3.5 py-3">
          <p className="text-[0.86rem]">
            {data.waitingForTimes
              ? "You asked for times. Waiting for the candidate to pick some."
              : data.offeredTimes > 0
                ? `The candidate offered ${data.offeredTimes} ${data.offeredTimes === 1 ? "time" : "times"}. Book one with your interviewers.`
                : "Ask the candidate which times suit them. They pick slots; you see only the times they pick."}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.offeredTimes > 0 && (
              <Link href={`/corporate/interviews?application=${applicationId}`} className={inkBtn}>
                <CalendarPlus {...ICON} />
                Schedule
              </Link>
            )}
            {!data.waitingForTimes && (
              <button
                type="button"
                className={actionBtn}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (!actions) return tell("Example interviews. Nothing changes here.", true);
                    const problem = await actions.askTimes(applicationId);
                    tell(problem ?? "Asked for times in Messages. You'll see their picks here and in the chat.", !!problem);
                  })
                }
              >
                Ask for times
              </button>
            )}
          </div>
        </div>
      )}
      {data.phone && (
        <p className="flex items-center gap-2 text-[0.88rem]">
          <Phone {...ICON} className="text-muted" />
          <span className="text-muted">Phone, shared for the interview:</span>
          <span className="font-medium">{data.phone}</span>
        </p>
      )}
      {data.interviews.length === 0 ? (
        <p className="text-[0.86rem] text-muted">No interviews yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.interviews.map((iv) => (
            <li key={iv.id}>
              <InterviewCard iv={iv} actions={actions} onDone={tell} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
