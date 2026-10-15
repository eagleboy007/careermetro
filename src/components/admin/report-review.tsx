"use client";

import { Check, Eye, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ReportDecision, ReportReviewAction, ReportReviewView } from "@/lib/schemas/admin";

/*
 * Reports (/admin/reports, FR-45; docs/plans/reports-review-plan.md): open reports from the Inbox and job pages,
 * oldest first, with the deadlines the Grievances page promises. Each row: the reason, what was reported and the
 * reported message or job, the reporter's note, the times, and Acknowledge, Action taken and Dismiss. People are first
 * name and last initial; never an email or phone. Neutral colours, as on the other admin pages: a passed deadline says
 * "Overdue" in words and weight, not in red. Results are announced in a polite live region. After a row leaves the
 * list, focus moves to the next row's first button, or to the list heading; it never drops to the page. Buttons use
 * aria-disabled while a review is running. Without `review` (the /design page) the buttons do nothing.
 */

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
/** 44px tall targets. */
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line bg-surface text-ink hover:bg-surface-2`;

/** "15 Oct, 10:00" in India time. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  return `${day}, ${time}`;
}

function Due({ by, now, done }: { by: string; now: string; done?: string | null }) {
  if (done) return <>Done {formatWhen(done)}</>;
  const late = by < now;
  return late ? <strong className="font-semibold">Overdue since {formatWhen(by)}</strong> : <>By {formatWhen(by)}</>;
}

/** One open report with its actions. */
export function ReportRow({ report: r, now, pending, onDecide }: { report: ReportReviewView; now: string; pending: boolean; onDecide?: (decision: ReportDecision) => void }) {
  const off = pending || !onDecide;
  const press = (decision: ReportDecision) => () => {
    if (!off) onDecide?.(decision);
  };
  const titleId = `report-${r.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:gap-5 min-[760px]:p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 id={titleId} className="text-[1.05rem] font-semibold [overflow-wrap:anywhere]">
          {r.reason}
        </h3>
        <p className="text-[0.86rem]">{r.context ? r.context.label : `${r.what}, no longer on CareerMetro`}.</p>
        {r.context?.text && <blockquote className="whitespace-pre-line rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] [overflow-wrap:anywhere]">{r.context.text}</blockquote>}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.86rem] min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Item label="Reported by">{r.reporter}</Item>
          <Item label="Reported">{formatWhen(r.reportedAt)}</Item>
          <Item label="Acknowledge">
            <Due by={r.acknowledgeBy} now={now} done={r.acknowledgedAt} />
          </Item>
          <Item label="Decide">
            <Due by={r.decideBy} now={now} />
          </Item>
        </dl>
        {r.note && (
          <p className="text-[0.86rem] [overflow-wrap:anywhere]">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Their note </span>
            {r.note}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 min-[760px]:w-[200px] min-[760px]:flex-col min-[760px]:items-stretch">
        {!r.acknowledgedAt && (
          <button type="button" data-first-action={r.id} aria-disabled={off || undefined} onClick={press("acknowledge")} aria-label={`Acknowledge: ${r.reason}, reported by ${r.reporter}`} className={ghost}>
            <Eye {...ICON} />
            Acknowledge
          </button>
        )}
        <button
          type="button"
          data-first-action={r.acknowledgedAt ? r.id : undefined}
          aria-disabled={off || undefined}
          onClick={press("actioned")}
          aria-label={`Action taken: ${r.reason}, reported by ${r.reporter}`}
          className={solid}
        >
          <Check {...ICON} />
          Action taken
        </button>
        <button type="button" aria-disabled={off || undefined} onClick={press("dismissed")} aria-label={`Dismiss: ${r.reason}, reported by ${r.reporter}`} className={ghost}>
          <X {...ICON} />
          Dismiss
        </button>
      </div>
    </article>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[0.7rem] uppercase leading-[1.9] tracking-[0.06em] text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** The whole list with its live region. `now` is the server's time, so the page reads the same on both sides. */
export function ReportReview({ reports, now, review }: { reports: ReportReviewView[]; now: string; review?: ReportReviewAction }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  /** After a review: the reviewed row, the rows after it, its place, and the list it was pressed on. */
  const focusAfter = useRef<{ id: string; after: string[]; index: number; until: ReportReviewView[] } | null>(null);

  useEffect(() => {
    const f = focusAfter.current;
    if (!f || reports === f.until) return;
    // The new list has arrived: the same row if it stayed (acknowledged), else the next row, else the heading.
    focusAfter.current = null;
    const present = new Set(reports.map((r) => r.id));
    const nextId = present.has(f.id) ? f.id : (f.after.find((id) => present.has(id)) ?? reports[Math.min(f.index, reports.length - 1)]?.id);
    const target = nextId ? rootRef.current?.querySelector<HTMLElement>(`[data-first-action="${CSS.escape(nextId)}"]`) : null;
    (target ?? headingRef.current)?.focus();
  }, [reports, message]);

  const decide = (r: ReportReviewView, index: number, decision: ReportDecision) =>
    review &&
    start(async () => {
      setMessage("");
      const result = await review(r.id, decision);
      if (result.ok) focusAfter.current = { id: r.id, after: reports.slice(index + 1).map((x) => x.id), index, until: reports };
      setMessage(result.message);
    });

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Admin</span>
        <h1 className="text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Reports</h1>
        <p className="text-[0.9rem] text-muted">
          Open reports from chats and job pages, oldest first. Acknowledge each within 24 hours. Act on sexual content or impersonation within 24
          hours, other rule breaks within 72 hours, and decide anything else within 15 days. Suspend a company from Company review. Action taken and
          Dismiss close the report.
        </p>
      </div>

      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>

      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
        Open · {reports.length}
      </h2>

      {reports.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">Nothing to review. No report is open.</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-3">
          {reports.map((r, index) => (
            <li key={r.id}>
              <ReportRow report={r} now={now} pending={pending} onDecide={review ? (d) => decide(r, index, d) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
