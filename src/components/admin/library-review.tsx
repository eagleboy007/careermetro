"use client";

import { Check, Copy, EyeOff, Eye, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { BrokenLinkRow, LibraryAdminView, SuggestionRow } from "@/lib/schemas";
import { RESOURCE_REPORT_REASON_LABELS, RESOURCE_REPORT_REASONS, SUGGESTION_DECLINE_LABELS, SUGGESTION_DECLINE_REASONS } from "@/lib/schemas/constants";
import type { ProofReviewResult } from "@/lib/schemas/admin";

/*
 * Library review (/admin/library, docs/plans/library-part-2-plan.md): Broken links, one row per resource with open
 * reports (and links already hidden, so they can be shown again), and Suggestions waiting for a reviewer, both oldest
 * first. A suggested link opens in a new tab with no referrer: the server never fetches it. No reporter or suggester
 * is shown. Neutral colours, as on the other admin pages: cobalt means progress and red, amber and green gap status.
 * Results are announced in a polite live region, and focus moves to the list's heading after a change, never to the
 * page. Buttons use aria-disabled while a change is running. Without the actions (the /design page) nothing happens.
 */

export type ResourceDecideAction = (resourceId: string, decision: string) => Promise<ProofReviewResult>;
export type SuggestionDecideAction = (suggestionId: string, decision: string, declineReason: string | null) => Promise<ProofReviewResult>;

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
/** 44px tall targets. */
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line bg-surface text-ink hover:bg-surface-2`;
const LABEL = "font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted";
const HEADING = `${LABEL} focus:outline-2 focus:outline-offset-2 focus:outline-ink`;

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[0.7rem] uppercase leading-[1.9] tracking-[0.06em] text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** One reported or hidden link with its actions. */
export function BrokenLinkCard({ row, pending, onDecide }: { row: BrokenLinkRow; pending: boolean; onDecide?: (decision: "hide" | "show" | "dismiss") => void }) {
  const off = pending || !onDecide;
  const press = (d: "hide" | "show" | "dismiss") => () => {
    if (!off) onDecide?.(d);
  };
  const titleId = `link-${row.id}`;
  const reasons = RESOURCE_REPORT_REASONS.filter((r) => row.counts[r] > 0);
  const open = reasons.reduce((n, r) => n + row.counts[r], 0);
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:gap-5 min-[760px]:p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 id={titleId} className="text-[1.05rem] font-semibold [overflow-wrap:anywhere]">
          {row.title}
        </h3>
        {row.hidden && <p className="self-start rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium">Hidden from the Library, paths and rides</p>}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.86rem] min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Item label="Source">{row.provider}</Item>
          <Item label="Reports">{open ? reasons.map((r) => `${RESOURCE_REPORT_REASON_LABELS[r]} · ${row.counts[r]}`).join(", ") : <span className="text-muted">None open</span>}</Item>
          <Item label="First report">{row.firstReported ? formatDay(row.firstReported) : <span className="text-muted">None open</span>}</Item>
          <Item label="Link check">{row.lastChecked ? `${row.healthy ? "Working" : "Broken"} on ${formatDay(row.lastChecked)}` : <span className="text-muted">Not checked yet</span>}</Item>
          <Item label="Link">
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 [overflow-wrap:anywhere]">
              Open the link
              <ExternalLink {...ICON} size={14} className="shrink-0" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Item>
        </dl>
      </div>
      <div className="flex flex-wrap gap-2 min-[760px]:w-[230px] min-[760px]:flex-col min-[760px]:items-stretch">
        {row.hidden ? (
          <button type="button" aria-disabled={off || undefined} onClick={press("show")} aria-label={`Show again: ${row.title}`} className={solid}>
            <Eye {...ICON} />
            Show again
          </button>
        ) : (
          <button type="button" aria-disabled={off || undefined} onClick={press("hide")} aria-label={`Hide link: ${row.title}`} className={solid}>
            <EyeOff {...ICON} />
            Hide link
          </button>
        )}
        {open > 0 && (
          <button type="button" aria-disabled={off || undefined} onClick={press("dismiss")} aria-label={`Dismiss reports: ${row.title}`} className={ghost}>
            <X {...ICON} />
            Dismiss reports
          </button>
        )}
      </div>
    </article>
  );
}

/** One suggestion with Accept, Already in the Library, and Decline with a reason. */
export function SuggestionCard({
  row,
  pending,
  onDecide,
}: {
  row: SuggestionRow;
  pending: boolean;
  onDecide?: (decision: "accepted" | "duplicate" | "declined", reason: string | null) => void;
}) {
  const off = pending || !onDecide;
  const [reason, setReason] = useState<string>(SUGGESTION_DECLINE_REASONS[0]);
  const press = (d: "accepted" | "duplicate" | "declined") => () => {
    if (!off) onDecide?.(d, d === "declined" ? reason : null);
  };
  const titleId = `suggestion-${row.id}`;
  const selectId = `${titleId}-reason`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:gap-5 min-[760px]:p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 id={titleId} className="text-[1.05rem] font-semibold [overflow-wrap:anywhere]">
          {row.host}
        </h3>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.86rem]">
          <Item label="Link">
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 [overflow-wrap:anywhere]">
              {row.url}
              <ExternalLink {...ICON} size={14} className="shrink-0" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Item>
          <Item label="For">{row.skill ?? "Other"}</Item>
          <Item label="Sent">{formatDay(row.sent)}</Item>
        </dl>
      </div>
      <div className="flex flex-wrap gap-2 min-[760px]:w-[230px] min-[760px]:flex-col min-[760px]:items-stretch">
        <button type="button" aria-disabled={off || undefined} onClick={press("accepted")} aria-label={`Accept: ${row.host}`} className={solid}>
          <Check {...ICON} />
          Accept
        </button>
        <button type="button" aria-disabled={off || undefined} onClick={press("duplicate")} aria-label={`Already in the Library: ${row.host}`} className={ghost}>
          <Copy {...ICON} />
          Already in the Library
        </button>
        <label htmlFor={selectId} className="sr-only">
          Why decline {row.host}
        </label>
        <select
          id={selectId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11 rounded-full border border-line-strong bg-surface px-3 text-[0.86rem] text-ink"
        >
          {SUGGESTION_DECLINE_REASONS.map((r) => (
            <option key={r} value={r}>
              {SUGGESTION_DECLINE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="button" aria-disabled={off || undefined} onClick={press("declined")} aria-label={`Decline: ${row.host}`} className={ghost}>
          <X {...ICON} />
          Decline
        </button>
      </div>
    </article>
  );
}

/** Both lists with their live region. */
export function LibraryReview({
  queue,
  decideResource,
  decideSuggestion,
}: {
  queue: LibraryAdminView;
  decideResource?: ResourceDecideAction;
  decideSuggestion?: SuggestionDecideAction;
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const brokenId = useId();
  const suggestId = useId();
  const brokenRef = useRef<HTMLHeadingElement>(null);
  const suggestRef = useRef<HTMLHeadingElement>(null);
  const [focusOn, setFocusOn] = useState<{ list: "broken" | "suggestions"; n: number } | null>(null);

  useEffect(() => {
    if (focusOn) (focusOn.list === "broken" ? brokenRef : suggestRef).current?.focus();
  }, [focusOn]);

  const run = (list: "broken" | "suggestions", call: () => Promise<ProofReviewResult>) =>
    start(async () => {
      setMessage("");
      const result = await call();
      setMessage(result.message);
      if (result.ok) setFocusOn((f) => ({ list, n: (f?.n ?? 0) + 1 }));
    });

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Admin</span>
        <h1 className="text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Library review</h1>
        <p className="text-[0.9rem] text-muted">
          Links people reported, and free resources people suggested. Hide link takes it out of the Library, paths and rides at once. Accepting a
          suggestion only notes it: add it to src/content/resources.json in a pull request, so the link check and the free-only review run.
        </p>
      </div>

      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>

      <h2 ref={brokenRef} id={brokenId} tabIndex={-1} className={HEADING}>
        Broken links · {queue.broken.length}
      </h2>
      {queue.broken.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">No link is reported or hidden.</p>
      ) : (
        <ul aria-labelledby={brokenId} className="flex flex-col gap-3">
          {queue.broken.map((row) => (
            <li key={row.id}>
              <BrokenLinkCard row={row} pending={pending} onDecide={decideResource ? (d) => run("broken", () => decideResource(row.id, d)) : undefined} />
            </li>
          ))}
        </ul>
      )}

      <h2 ref={suggestRef} id={suggestId} tabIndex={-1} className={HEADING}>
        Suggestions · {queue.suggestions.length}
      </h2>
      {queue.suggestions.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">No suggestion is waiting.</p>
      ) : (
        <ul aria-labelledby={suggestId} className="flex flex-col gap-3">
          {queue.suggestions.map((row) => (
            <li key={row.id}>
              <SuggestionCard
                row={row}
                pending={pending}
                onDecide={decideSuggestion ? (d, reason) => run("suggestions", () => decideSuggestion(row.id, d, reason)) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
