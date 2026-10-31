"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CHAT_REPORT_REASON_LABELS, REPORT_REASON_LABELS } from "@/lib/inbox/types";
import { REPORT_NOTE_MAX_CHARS } from "@/lib/schemas/constants";
import type { ReportReason } from "@/lib/schemas/inbox";

const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.82rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";

/**
 * Report a person from Network (a row or their profile, handoff 12j), inline under it: a reason, which sets how fast
 * the review team must act, and an optional note. Reports go to the same review queue as the Inbox's. No pop-up.
 */
export function ReportPerson({ name, busy, onSend, onCancel }: { name: string; busy?: true; onSend: (reason: ReportReason, note: string) => void; onCancel: () => void }) {
  const ids = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const first = name.split(" ")[0];
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  return (
    <form
      aria-label={`Report ${name}`}
      className="flex flex-col gap-2 rounded-md bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (!reason) {
          setError("Choose what happened.");
          return;
        }
        setError(null);
        onSend(reason, note);
      }}
    >
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-[0.86rem] font-semibold">Report {name}?</legend>
        {(Object.keys(CHAT_REPORT_REASON_LABELS) as ReportReason[]).map((key, i) => (
          <label key={key} className="flex min-h-11 items-center gap-2 text-[0.84rem]">
            <input ref={i === 0 ? firstRef : undefined} type="radio" name={`${ids}-reason`} value={key} checked={reason === key} onChange={() => setReason(key)} className="accent-ink" />
            {REPORT_REASON_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-[0.8rem] text-muted">
        Anything we should know (optional)
        <textarea rows={2} maxLength={REPORT_NOTE_MAX_CHARS} value={note} onChange={(e) => setNote(e.target.value)} className="resize-none rounded-[10px] border border-line-strong bg-bg px-2.5 py-2 text-[0.84rem] text-ink" />
      </label>
      <small className="text-[0.78rem] text-muted">Our team reviews it. {first} isn&rsquo;t told who reported.</small>
      {error && (
        <p role="alert" className="text-[0.84rem] font-medium text-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="submit" className={ghost} aria-disabled={busy}>
          Send report
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
