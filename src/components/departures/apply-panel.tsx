"use client";

import { Check, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { actionBtn, inkBtn } from "@/components/corporate/jobs-panel";
import { ICON } from "@/components/corporate/parts";
import type { ApplyAction, ApplyState, CanJoin } from "@/lib/corporate/types";
import { APPLICATION_STAGE_LABELS, APPLY_NEVER, APPLY_SHARES, CAN_JOIN, CAN_JOIN_LABELS } from "@/lib/schemas/constants";

/**
 * Apply on CareerMetro (dev/corporate-plan.md build step 4), on a job a verified company posted. Nothing is sent until
 * the person ticks a consent naming that one company and saying what it will see (DPDP Act). They also say when they
 * can join, never a notice period. Once applied, the card says where it stands and links to Arrivals. Focus goes to the
 * first field when the consent opens, back to Apply on Cancel, and to the confirmation once sent.
 */
export function ApplyPanel({ jobId, company, title, state, action }: { jobId: string; company: string; title: string; state: ApplyState; action?: ApplyAction }) {
  const [open, setOpen] = useState(false);
  const [canJoin, setCanJoin] = useState<CanJoin | "">("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLSelectElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const wasApplied = useRef(state.kind === "applied");

  useEffect(() => {
    if (open) firstRef.current?.focus();
    else if (wasOpen.current) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (state.kind === "applied" && !wasApplied.current) doneRef.current?.focus();
    wasApplied.current = state.kind === "applied";
  }, [state.kind]);

  if (state.kind === "signed_out") {
    return (
      <Link href="/sign-in?next=/departures" className={`${actionBtn} self-start`}>
        <Send {...ICON} />
        Sign in to apply
      </Link>
    );
  }
  if (state.kind === "no_resume") {
    return (
      <p className="text-[0.84rem] text-muted">
        Add your resume first, so {company} can see how you match this job.{" "}
        <Link href="/today" className="inline-flex min-h-11 items-center text-ink underline underline-offset-2">
          Add your resume
        </Link>
      </p>
    );
  }
  if (state.kind === "applied") {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.86rem]">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Check {...ICON} />
          {state.withdrawn ? "You withdrew this application" : `Applied · ${APPLICATION_STAGE_LABELS[state.stage]}`}
        </span>
        <Link href="/arrivals" className="inline-flex min-h-11 items-center text-ink underline underline-offset-2">
          Follow it on Arrivals
        </Link>
      </div>
    );
  }
  if (!open) {
    return (
      <button ref={buttonRef} type="button" aria-label={`Apply on CareerMetro: ${title}`} className={`${inkBtn} self-start`} onClick={() => setOpen(true)}>
        <Send {...ICON} />
        Apply on CareerMetro
      </button>
    );
  }
  return (
    <form
      aria-labelledby={`${ids}-h`}
      className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface-2 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canJoin) {
          setError("Pick when you can join.");
          return;
        }
        if (!consent) {
          setError(`Tick the box to share these with ${company}.`);
          return;
        }
        if (!action) {
          setError("Sign in to apply.");
          return;
        }
        start(async () => {
          setError(null);
          const message = await action(jobId, canJoin, consent);
          if (message) setError(message);
        });
      }}
    >
      <h4 id={`${ids}-h`} className="text-[0.95rem] font-semibold [overflow-wrap:anywhere]">
        {company} will see
      </h4>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-[0.84rem]">
        {APPLY_SHARES.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="text-[0.82rem] text-muted">{APPLY_NEVER}</p>
      <label className="flex flex-col gap-1.5 text-[0.84rem] font-semibold">
        When can you join?
        <select
          ref={firstRef}
          value={canJoin}
          onChange={(e) => setCanJoin(e.target.value as CanJoin)}
          className="min-h-11 rounded-sm border border-line bg-surface px-3 text-[0.88rem] font-normal text-ink"
        >
          <option value="">Choose</option>
          {CAN_JOIN.map((c) => (
            <option key={c} value={c}>
              {CAN_JOIN_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 items-start gap-2.5 text-[0.84rem]">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-ink" />
        <span>
          I agree to share these with {company} for this job. I can withdraw the application on Arrivals, which stops further sharing.
        </span>
      </label>
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="text-[0.84rem] font-medium text-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={inkBtn} disabled={pending}>
          Send application
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
