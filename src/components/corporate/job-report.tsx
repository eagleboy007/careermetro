"use client";

import { Flag } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { JobReportAction } from "@/lib/corporate/types";
import { REPORT_REASON_LABELS } from "@/lib/inbox/types";
import type { ReportReason } from "@/lib/schemas/inbox";
import { actionBtn } from "./jobs-panel";
import { ICON } from "./parts";

/**
 * "Report this job" (dev/corporate-plan.md, Abuse and compliance): a reason and an optional note, into the same reports
 * queue as the Inbox, looked at within 24 hours. Focus goes to the first reason when it opens, back to the button on
 * Cancel, and to the confirmation once sent. Without `action` (signed out, or the /design page) it says to sign in.
 */
export function JobReport({ jobId, title, action }: { jobId: string; title: string; action?: JobReportAction }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  const ids = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) firstRef.current?.focus();
    else if (wasOpen.current && !sent) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open, sent]);
  useEffect(() => {
    if (sent) doneRef.current?.focus();
  }, [sent]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (sent) {
    return (
      <p ref={doneRef} tabIndex={-1} role="status" className="text-[0.84rem] text-muted">
        Reported. We look at it within 24 hours. The company isn&apos;t told who reported it.
      </p>
    );
  }
  if (!open) {
    return (
      <button ref={buttonRef} type="button" aria-label={`Report this job: ${title}`} className={`${actionBtn} self-start`} onClick={() => setOpen(true)}>
        <Flag {...ICON} />
        Report this job
      </button>
    );
  }
  return (
    <form
      id={`${ids}-form`}
      aria-label={`Report ${title}`}
      className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason) {
          setError("Choose what happened.");
          return;
        }
        if (!action) {
          setError("Sign in to report a job.");
          return;
        }
        start(async () => {
          setError(null);
          const message = await action(jobId, reason, note);
          if (message) setError(message);
          else setSent(true);
        });
      }}
    >
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-[0.86rem] font-semibold">What&apos;s wrong with this job?</legend>
        {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((key, i) => (
          <label key={key} className="flex min-h-11 items-center gap-2 text-[0.84rem]">
            <input ref={i === 0 ? firstRef : undefined} type="radio" name={`${ids}-reason`} value={key} checked={reason === key} onChange={() => setReason(key)} className="accent-ink" />
            {REPORT_REASON_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-[0.8rem] text-muted">
        Anything we should know (optional)
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="resize-none rounded-[10px] border border-line-strong bg-bg px-2.5 py-2 text-[0.84rem] text-ink" />
      </label>
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="text-[0.84rem] font-medium text-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={actionBtn} disabled={pending}>
          Send report
        </button>
        <button
          type="button"
          className={actionBtn}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
