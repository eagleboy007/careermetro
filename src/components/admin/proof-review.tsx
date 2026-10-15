"use client";

import { Check, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { HeldProofView, ProofReviewAction, ProofReviewDecision } from "@/lib/schemas/admin";

/*
 * Held proofs (/admin/proofs, FR-44; dev/held-proof-review-plan.md): certificates held because their credential id or
 * Credly badge is already on another account. One row per claim, with Accept for this person and Reject. The person is
 * shown as first name and last initial only; never an email, phone, resume text or credential id. Neutral colours, as
 * on the company review: cobalt means progress and red, amber and green mean gap status. Results are announced in a
 * polite live region. After a review, focus moves to the next row's first button, or to the list heading when no rows
 * are left; it never drops to the page. Buttons use aria-disabled while a review is running, so focus stays on them.
 * Without `review` (the /design page) the buttons do nothing.
 */

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
/** 44px tall targets. */
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line bg-surface text-ink hover:bg-surface-2`;

/** One held claim with its two actions. */
export function HeldProofRow({ proof: p, pending, onDecide }: { proof: HeldProofView; pending: boolean; onDecide?: (decision: ProofReviewDecision) => void }) {
  const off = pending || !onDecide;
  const press = (decision: ProofReviewDecision) => () => {
    if (!off) onDecide?.(decision);
  };
  const titleId = `proof-${p.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:gap-5 min-[760px]:p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 id={titleId} className="text-[1.05rem] font-semibold [overflow-wrap:anywhere]">
          {p.certificate}
        </h3>
        <p className="text-[0.86rem]">{p.reasonText}.</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.86rem] min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Item label="Person">{p.person}</Item>
          <Item label="Issuer">{p.issuer || <span className="text-muted">Not given</span>}</Item>
          <Item label="Submitted">{formatDay(p.submittedOn)}</Item>
          <Item label="Other accounts">{p.others}</Item>
          {p.badgeUrl && (
            <Item label="Credly">
              <a href={p.badgeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                Badge page
                <ExternalLink {...ICON} size={14} className="shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Item>
          )}
        </dl>
      </div>
      <div className="flex flex-wrap gap-2 min-[760px]:w-[230px] min-[760px]:flex-col min-[760px]:items-stretch">
        <button
          type="button"
          data-first-action={p.id}
          aria-disabled={off || undefined}
          onClick={press("accept")}
          aria-label={`Accept for this person: ${p.person}, ${p.certificate}`}
          className={solid}
        >
          <Check {...ICON} />
          Accept for this person
        </button>
        <button type="button" aria-disabled={off || undefined} onClick={press("reject")} aria-label={`Reject: ${p.person}, ${p.certificate}`} className={ghost}>
          <X {...ICON} />
          Reject
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

/** The whole list with its live region. */
export function ProofReview({ proofs, review }: { proofs: HeldProofView[]; review?: ProofReviewAction }) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  /** After a review: the rows that came after the reviewed one, its place, and the list it was pressed on. */
  const focusAfter = useRef<{ after: string[]; index: number; until: HeldProofView[] } | null>(null);

  useEffect(() => {
    const f = focusAfter.current;
    if (!f || proofs === f.until) return;
    // The new list has arrived: the next row still there, else the row now in its place, else the heading.
    focusAfter.current = null;
    const present = new Set(proofs.map((p) => p.id));
    const nextId = f.after.find((id) => present.has(id)) ?? proofs[Math.min(f.index, proofs.length - 1)]?.id;
    const target = nextId ? rootRef.current?.querySelector<HTMLElement>(`[data-first-action="${CSS.escape(nextId)}"]`) : null;
    (target ?? headingRef.current)?.focus();
  }, [proofs, message]);

  const decide = (p: HeldProofView, index: number, decision: ProofReviewDecision) =>
    review &&
    start(async () => {
      setMessage("");
      const result = await review(p.id, decision);
      if (result.ok) focusAfter.current = { after: proofs.slice(index + 1).map((x) => x.id), index, until: proofs };
      setMessage(result.message);
    });

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Admin</span>
        <h1 className="text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Held proofs</h1>
        <p className="text-[0.9rem] text-muted">
          Certificates held because their credential id or Credly badge is already on another account. Accept the claim that belongs to this person: it
          fills their goal, and every other account&apos;s claim on the same credential or badge is rejected. Reject tells the person it couldn&apos;t be
          confirmed and how to raise it from Grievances.
        </p>
      </div>

      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>

      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
        Waiting for review · {proofs.length}
      </h2>

      {proofs.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">Nothing to review. No certificate is held.</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-3">
          {proofs.map((p, index) => (
            <li key={p.id}>
              <HeldProofRow proof={p} pending={pending} onDecide={review ? (d) => decide(p, index, d) : undefined} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
