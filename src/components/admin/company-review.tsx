"use client";

import { Ban, Check, ExternalLink, Globe, RotateCcw, UserX } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { OrgStatusBadge } from "@/components/corporate/parts";
import { formatDay } from "@/lib/corporate/format";
import type { AdminCompanyView, ReviewAction, ReviewDecision } from "@/lib/corporate/types";
import { ORG_TYPE_LABELS } from "@/lib/schemas/constants";

/*
 * The company review page (/admin/companies; dev/corporate-plan.md, call B): companies waiting for review, suspended
 * ones, and any left without a Recruiter admin, with Verify, Suspend (after a confirm step) and Verify again. Company
 * fields and counts only, never anyone's email or phone. Neutral colours: cobalt means progress and red, amber and
 * green mean gap status, so a company's state is told by words and icons. Results are announced in a polite live
 * region, and focus never drops to the page when a row leaves the list. Without `review` (the /design page) the
 * buttons are off.
 */

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
/** 44px tall targets. */
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium disabled:cursor-not-allowed disabled:opacity-60";
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line bg-surface text-ink hover:bg-surface-2`;
const flag = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink";

const host = (website: string) => {
  try {
    return new URL(website).host;
  } catch {
    return website;
  }
};

export type RowHandlers = {
  pending: boolean;
  confirming: boolean;
  onDecide?: (decision: ReviewDecision) => void;
  onAskSuspend?: () => void;
  onCancelSuspend?: () => void;
};

/** One company on the review list, with its actions. */
export function AdminCompanyRow({ company: c, pending, confirming, onDecide, onAskSuspend, onCancelSuspend }: { company: AdminCompanyView } & RowHandlers) {
  const off = pending || !onDecide;
  return (
    <article aria-labelledby={`co-${c.id}`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:gap-5 min-[760px]:p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`co-${c.id}`} data-company-heading={c.id} tabIndex={-1} className="mr-1 text-[1.1rem] font-semibold [overflow-wrap:anywhere]">
            {c.name}
          </h2>
          <OrgStatusBadge status={c.status} />
          {c.noAdmin && (
            <span className={flag}>
              <UserX {...ICON} size={14} />
              No admin
            </span>
          )}
          {c.websiteOnOtherDomain && (
            <span className={flag}>
              <Globe {...ICON} size={14} />
              Website on another domain
            </span>
          )}
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.86rem] min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Item label="Domain">
            <span className="font-mono text-[0.8rem] [overflow-wrap:anywhere]">{c.domain}</span>
          </Item>
          <Item label="Website">
            {c.website ? (
              <a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 [overflow-wrap:anywhere]">
                {host(c.website)}
                <ExternalLink {...ICON} size={14} className="shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span className="text-muted">None given</span>
            )}
          </Item>
          <Item label="Type">{ORG_TYPE_LABELS[c.type]}</Item>
          <Item label="City">{c.city || <span className="text-muted">Not given</span>}</Item>
          <Item label="Size">{c.size || <span className="text-muted">Not given</span>}</Item>
          <Item label="Signed up">{formatDay(c.createdOn)}</Item>
          <Item label="Members">{c.members}</Item>
          <Item label="Admins">{c.admins}</Item>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2 min-[760px]:w-[220px] min-[760px]:flex-col min-[760px]:items-stretch">
        {confirming ? (
          <div role="group" aria-labelledby={`co-${c.id}-confirm`} className="flex w-full flex-col gap-2 rounded-md bg-surface-2 p-3">
            <p id={`co-${c.id}-confirm`} className="text-[0.84rem]">
              Suspend {c.name}? Its jobs and messages pause until it is verified again. Its team keeps access to Corporate.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" autoFocus disabled={off} onClick={() => onDecide?.("suspend")} className={solid}>
                <Ban {...ICON} />
                Suspend company
              </button>
              <button type="button" disabled={pending} onClick={onCancelSuspend} className={ghost}>
                Cancel
              </button>
            </div>
          </div>
        ) : c.status === "suspended" ? (
          <button type="button" disabled={off} onClick={() => onDecide?.("verify")} aria-label={`Verify again: ${c.name}`} className={solid}>
            <RotateCcw {...ICON} />
            Verify again
          </button>
        ) : (
          <>
            {c.status === "pending" && (
              <button type="button" disabled={off} onClick={() => onDecide?.("verify")} aria-label={`Verify ${c.name}`} className={solid}>
                <Check {...ICON} />
                Verify
              </button>
            )}
            <button type="button" data-suspend={c.id} disabled={off} onClick={onAskSuspend} aria-label={`Suspend ${c.name}`} className={ghost}>
              <Ban {...ICON} />
              Suspend
            </button>
          </>
        )}
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
export function CompanyReview({ companies, review }: { companies: AdminCompanyView[]; review?: ReviewAction }) {
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);
  /** Where focus goes after a review: that company's name, or the row now in its place, or the empty-list line. */
  const focusAfter = useRef<{ id: string; index: number; until: AdminCompanyView[] | null } | null>(null);
  /** The Suspend button to go back to after Cancel. */
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    const f = focusAfter.current;
    const root = rootRef.current;
    if (!f || !root) return;
    const headings = [...root.querySelectorAll<HTMLElement>("[data-company-heading]")];
    const own = headings.find((h) => h.dataset.companyHeading === f.id);
    (own ?? headings[Math.min(f.index, headings.length - 1)] ?? emptyRef.current)?.focus();
    // After a change, the list reloads: keep placing focus until the new list has arrived.
    if (f.until === null || companies !== f.until) focusAfter.current = null;
  }, [companies, message]);

  useEffect(() => {
    if (confirming !== null) return;
    const id = returnTo.current;
    returnTo.current = null;
    if (id) rootRef.current?.querySelector<HTMLElement>(`[data-suspend="${CSS.escape(id)}"]`)?.focus();
  }, [confirming]);

  const decide = (c: AdminCompanyView, index: number, decision: ReviewDecision) =>
    review &&
    start(async () => {
      setMessage("");
      const result = await review(c.id, decision);
      focusAfter.current = { id: c.id, index, until: result.ok ? companies : null };
      setConfirming(null);
      setMessage(result.message);
    });

  const waiting = companies.filter((c) => c.status === "pending").length;
  const suspended = companies.filter((c) => c.status === "suspended").length;
  const noAdmin = companies.filter((c) => c.noAdmin).length;

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Admin</span>
        <h1 className="text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Company review</h1>
        <p className="text-[0.9rem] text-muted">
          Check that the name, domain and website belong to one company, and that the domain is the company&apos;s main one, not a subdomain such as a
          student mail domain. If it isn&apos;t, suspend it and ask them to sign up on the main domain.
        </p>
      </div>

      <p className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">
        {waiting} waiting · {suspended} suspended · {noAdmin} with no admin
      </p>

      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>

      {companies.length === 0 ? (
        <p ref={emptyRef} tabIndex={-1} className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">
          Nothing to review. No company is waiting or suspended, and every company has a Recruiter admin.
        </p>
      ) : (
        <ul aria-label="Companies to review" className="flex flex-col gap-3">
          {companies.map((c, index) => (
            <li key={c.id}>
              <AdminCompanyRow
                company={c}
                pending={pending}
                confirming={confirming === c.id}
                onDecide={review ? (d) => decide(c, index, d) : undefined}
                onAskSuspend={() => setConfirming(c.id)}
                onCancelSuspend={() => {
                  returnTo.current = c.id;
                  setConfirming(null);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
