"use client";

import { Check, FileText, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { istClock, istDayWords } from "@/lib/day-words";
import { INTAKE_SOURCE_LABELS, INTAKE_SOURCES, REMOVAL_REASON_MAX, type IntakeSource } from "@/lib/schemas/constants";
import { REPORT_REASONS, REPORT_TARGETS, type ReportReason, type ReportTarget } from "@/lib/schemas/constants";
import { REPORT_REASON_LABELS } from "@/lib/inbox/types";
import type { AppealDecisionInput, AppealView, IntakeInput, JunctionResult } from "@/lib/schemas/junction";
import { ORDER_DEADLINE_HOURS } from "@/lib/legal-timings";

/*
 * Junction's part of /admin/reports (FR-61, docs/plans/junction-plan.md sections 2.2 and 2.6): open appeals against a
 * hidden post or comment, nearest deadline first, each with Keep hidden or Show again and a required reason; and "Log
 * a complaint or order", which puts an emailed complaint, a court order or a government notice into the one queue with
 * its clock from when it reached us. Neutral colours, as on the other admin pages; a passed deadline reads Overdue in
 * words and weight. Results are announced in a polite live region. Without the actions (the /design page) nothing
 * happens. Who sent a complaint is kept on the record and never logged.
 */

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line bg-surface text-ink hover:bg-surface-2`;
const field = "w-full rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-[0.86rem] text-ink";
const label = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

const when = (iso: string) => `${istDayWords(iso)}, ${istClock(iso)}`;

const TARGET_WORDS: Record<ReportTarget, string> = { message: "A message", person: "A person", chat: "A chat", job: "A job", post: "A post", comment: "A comment" };

/** One open appeal, with the removed text, the author's note and the decision form. */
export function AppealRow({ appeal: a, now, off, onDecide }: { appeal: AppealView; now: string; off: boolean; onDecide?: (input: AppealDecisionInput) => Promise<boolean> }) {
  const [decision, setDecision] = useState<"upheld" | "reversed" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const ids = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const disabled = off || !onDecide;
  const late = a.decideBy < now;

  useEffect(() => {
    if (decision) fieldRef.current?.focus();
  }, [decision]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || !decision) return;
    if (!reason.trim()) {
      setError("Write the reason.");
      fieldRef.current?.focus();
      return;
    }
    if (await onDecide?.({ appealId: a.id, decision, reason: reason.trim() })) {
      setDecision(null);
      setReason("");
    }
  };

  const titleId = `appeal-${a.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <h3 id={titleId} className="text-[1rem] font-semibold [overflow-wrap:anywhere]">
        Appeal: {a.label}
      </h3>
      <blockquote className="whitespace-pre-line rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] [overflow-wrap:anywhere]">
        {a.title && <strong className="block font-semibold">{a.title}</strong>}
        {a.text}
      </blockquote>
      <p className="text-[0.86rem] [overflow-wrap:anywhere]">
        Hidden {istDayWords(a.removedAt)} under: {a.rule}.
      </p>
      <p className="text-[0.86rem] [overflow-wrap:anywhere]">
        <span className={label}>Their appeal </span>
        {a.note}
      </p>
      <p className="text-[0.86rem]">
        Appealed {when(a.appealedAt)}. {late ? <strong className="font-semibold">Overdue since {when(a.decideBy)}</strong> : <>Decide by {when(a.decideBy)}.</>}
      </p>
      {a.removedByYou && <p className="text-[0.82rem] text-muted">You hid this. Where another admin can, let them decide the appeal.</p>}
      {decision ? (
        <form onSubmit={submit} aria-labelledby={`${ids}-prompt`} className="flex flex-col gap-2.5 rounded-md border border-line bg-surface-2 p-3">
          <p id={`${ids}-prompt`} className="text-[0.86rem] font-medium">
            {decision === "reversed" ? "Show it to everyone again? Its author is told." : "Keep it hidden? Its author is told, with where to appeal next."}
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-reason`} className={label}>
              Reason
            </label>
            <textarea
              ref={fieldRef}
              id={`${ids}-reason`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={`${ids}-hint ${ids}-error`}
              maxLength={REMOVAL_REASON_MAX}
              rows={3}
              className={field}
            />
            <span id={`${ids}-hint`} className="text-[0.78rem] text-muted">
              Kept on the record for the grievance file.
            </span>
            <span id={`${ids}-error`} role="alert" className="text-[0.8rem] font-[550] text-ink empty:hidden">
              {error}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" aria-disabled={disabled || undefined} className={solid}>
              {decision === "reversed" ? <RotateCcw {...ICON} /> : <Check {...ICON} />}
              {decision === "reversed" ? "Show again" : "Keep hidden"}
            </button>
            <button type="button" onClick={() => setDecision(null)} className={ghost}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-disabled={disabled || undefined} onClick={() => !disabled && setDecision("upheld")} aria-label={`Keep hidden: ${a.label}`} className={ghost}>
            <Check {...ICON} />
            Keep hidden
          </button>
          <button type="button" aria-disabled={disabled || undefined} onClick={() => !disabled && setDecision("reversed")} aria-label={`Show again: ${a.label}`} className={ghost}>
            <RotateCcw {...ICON} />
            Show again
          </button>
        </div>
      )}
    </article>
  );
}

/** "Log a complaint or order": what reached us, when, from whom, and what it is about. */
export function IntakeForm({ off, onLog }: { off: boolean; onLog?: (input: IntakeInput) => Promise<boolean> }) {
  const ids = useId();
  const [source, setSource] = useState<IntakeSource>("email");
  const [receivedAt, setReceivedAt] = useState("");
  const [fromLabel, setFromLabel] = useState("");
  const [reference, setReference] = useState("");
  const [target, setTarget] = useState<ReportTarget>("post");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState<ReportReason>("other");
  const [error, setError] = useState("");
  const disabled = off || !onLog;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (!receivedAt || !fromLabel.trim() || !targetId.trim()) {
      setError("Fill in when it arrived, who sent it and the id of what it is about.");
      return;
    }
    // The field is India time; the server takes an instant with its offset.
    const ok = await onLog?.({ source, receivedAt: `${receivedAt}:00+05:30`, fromLabel: fromLabel.trim(), reference: reference.trim(), target, targetId: targetId.trim(), reason });
    if (ok) {
      setReceivedAt("");
      setFromLabel("");
      setReference("");
      setTargetId("");
      setError("");
    }
  };

  return (
    <form onSubmit={submit} aria-labelledby={`${ids}-title`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <h3 id={`${ids}-title`} className="text-[1rem] font-semibold">
        Log a complaint or order
      </h3>
      <p className="text-[0.86rem] text-muted">
        For an emailed complaint, a court order or a government notice. It joins the open reports with its deadline counted from when it reached us:{" "}
        {ORDER_DEADLINE_HOURS} hours for an order, otherwise the reason&apos;s own.
      </p>
      <div className="grid gap-3 min-[560px]:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-source`} className={label}>
            What it is
          </label>
          <select id={`${ids}-source`} value={source} onChange={(e) => setSource(e.target.value as IntakeSource)} className={field}>
            {INTAKE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {INTAKE_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-at`} className={label}>
            Reached us (India time)
          </label>
          <input id={`${ids}-at`} type="datetime-local" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} aria-required="true" className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-from`} className={label}>
            From
          </label>
          <input id={`${ids}-from`} value={fromLabel} onChange={(e) => setFromLabel(e.target.value)} maxLength={200} aria-required="true" className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-ref`} className={label}>
            Their reference (optional)
          </label>
          <input id={`${ids}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-target`} className={label}>
            About
          </label>
          <select id={`${ids}-target`} value={target} onChange={(e) => setTarget(e.target.value as ReportTarget)} className={field}>
            {REPORT_TARGETS.map((t) => (
              <option key={t} value={t}>
                {TARGET_WORDS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-id`} className={label}>
            Its id
          </label>
          <input id={`${ids}-id`} value={targetId} onChange={(e) => setTargetId(e.target.value)} maxLength={36} aria-required="true" className={`${field} font-mono`} />
        </div>
        <div className="flex flex-col gap-1 min-[560px]:col-span-2">
          <label htmlFor={`${ids}-reason`} className={label}>
            Reason
          </label>
          <select id={`${ids}-reason`} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className={field}>
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {REPORT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <span role="alert" className="text-[0.8rem] font-[550] text-ink empty:hidden">
        {error}
      </span>
      <div>
        <button type="submit" aria-disabled={disabled || undefined} className={solid}>
          <FileText {...ICON} />
          Log it
        </button>
      </div>
    </form>
  );
}

/** Appeals and the intake form, with their live region. `now` is the server's time. */
export function JunctionModeration({
  appeals,
  now,
  decide,
  log,
}: {
  appeals: AppealView[];
  now: string;
  decide?: (input: AppealDecisionInput) => Promise<JunctionResult>;
  log?: (input: IntakeInput) => Promise<JunctionResult>;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const headingId = useId();

  const run =
    <T,>(fn: ((input: T) => Promise<JunctionResult>) | undefined) =>
    (input: T) =>
      new Promise<boolean>((resolve) => {
        if (!fn) {
          resolve(false);
          return;
        }
        start(async () => {
          setMessage("");
          const result = await fn(input);
          setMessage(result.message);
          resolve(result.ok);
        });
      });

  return (
    <section aria-labelledby={headingId} className="mx-auto flex w-full max-w-[920px] flex-col gap-3">
      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>
      <h2 id={headingId} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">
        Appeals · {appeals.length}
      </h2>
      {appeals.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">No appeal is open.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {appeals.map((a) => (
            <li key={a.id}>
              <AppealRow appeal={a} now={now} off={pending} onDecide={decide ? run(decide) : undefined} />
            </li>
          ))}
        </ul>
      )}
      <IntakeForm off={pending} onLog={log ? run(log) : undefined} />
    </section>
  );
}
