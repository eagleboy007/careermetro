"use client";

import { Award, BadgeCheck, CalendarX, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { NO_NAME, firstName } from "@/lib/account/name";
import type { CredlyCheckResult } from "@/lib/proofs/result";
import type { MeCertification } from "@/lib/schemas";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

export type { CredlyCheckResult };

/**
 * Certifications on a profile (pending item 13, dev/profile-certs-plan.md): name, issuer, date and status, "Verified
 * with Credly" in ink with its badge (never a gap colour) or "Added by you" ("Added by you, check pending" for a Credly
 * badge Credly hasn't confirmed yet, owner only). On the owner's own profile an expired one
 * is marked, the Credly reason shows, and a Credly badge can be checked again; `onCheck` is the server action, and
 * without it (design page, example data) nothing is checked. Others see what src/lib/me/public.ts left in.
 */
export function ProfileCertifications({
  certs,
  mode,
  ownerName,
  onCheck,
  headingId,
}: {
  certs: MeCertification[];
  mode: "own" | "public";
  /** The profile's name, for "Added by Priya" when someone else is looking. */
  ownerName?: string;
  onCheck?: (proofId: string) => Promise<CredlyCheckResult>;
  /** The id of the list's heading (tabIndex -1). Focus goes there if a check takes the pressed row away. */
  headingId?: string;
}) {
  // The last check and its proof. A check can take its row off the list (a badge held for review no longer counts), so
  // the list says what happened and moves focus to its heading rather than leaving it on the page.
  const [last, setLast] = useState<{ proofId: string; result: CredlyCheckResult } | null>(null);
  const gone = last && !certs.some((c) => c.proofId === last.proofId) ? last : null;
  useEffect(() => {
    if (!gone || !headingId) return;
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById(headingId)?.focus();
  }, [gone, headingId]);
  const check = onCheck
    ? async (proofId: string) => {
        const result = await onCheck(proofId);
        setLast({ proofId, result });
        return result;
      }
    : undefined;

  // "you" would mean the viewer, so others read the person's first name.
  const first = ownerName && ownerName !== NO_NAME ? firstName(ownerName) : "";
  const addedBy = mode === "own" ? "Added by you" : first ? `Added by ${first}` : "Added by them";
  const status = mode === "own" && (
    <p role="status" className={gone ? "text-[0.76rem] text-ink" : "sr-only"}>
      {gone?.result.message ?? ""}
    </p>
  );
  if (!certs.length)
    return (
      <>
        {status}
        <p className="text-[0.8rem] text-muted">None yet.</p>
      </>
    );
  return (
    <>
      {status}
      <ul className="flex flex-col gap-3">
        {certs.map((c, i) => (
          <CertificationRow key={c.proofId ?? `resume-${i}-${c.name}`} cert={c} own={mode === "own"} addedBy={addedBy} onCheck={check} />
        ))}
      </ul>
    </>
  );
}

function CertificationRow({ cert: c, own, addedBy, onCheck }: { cert: MeCertification; own: boolean; addedBy: string; onCheck?: (proofId: string) => Promise<CredlyCheckResult> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CredlyCheckResult | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pressed = useRef(false);
  // The page refreshes after a check and the list can reorder (verified ones go first); if that took focus off the
  // button, put it back, so a keyboard user is never left on the page itself.
  useEffect(() => {
    if (!pressed.current || pending) return;
    pressed.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) button.current?.focus();
  }, [pending, result, c.status]);

  const check = () => {
    if (pending || !c.proofId) return;
    pressed.current = true;
    if (!onCheck) {
      setResult({ status: "refused", message: "This is example data, so nothing is checked." });
      return;
    }
    start(async () => setResult(await onCheck(c.proofId!)));
  };

  const verified = c.status === "verified";
  const details = [c.issuer, c.date && (c.fromResume ? `Passed ${c.date}` : `Issued ${c.date}`), c.fromResume && (own ? "from your resume" : "from their resume")].filter(Boolean).join(" · ");
  return (
    <li className="flex min-w-0 flex-col gap-1 text-[0.82rem]">
      <div className="flex min-w-0 items-start gap-2">
        {verified ? <BadgeCheck size={17} {...ICON} className="mt-px shrink-0 text-ink" /> : <Award size={17} {...ICON} className="mt-px shrink-0 text-muted" />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-semibold [overflow-wrap:anywhere]">{c.name}</span>
          {details && <small className="text-[0.74rem] text-muted [overflow-wrap:anywhere]">{details}</small>}
          <span className={`text-[0.76rem] ${verified ? "font-medium text-ink" : "text-muted"}`}>
            {verified ? "Verified with Credly" : c.status === "pending" ? `${addedBy}, check pending · only you see it` : addedBy}
          </span>
          {c.expired && (
            <span className="inline-flex items-center gap-1 text-[0.76rem] text-muted">
              <CalendarX size={13} {...ICON} />
              Expired {c.expired} · only you see it
            </span>
          )}
          {own && c.note && !verified && <span className="text-[0.76rem] text-muted">{c.note}</span>}
        </div>
      </div>
      {(c.badgeUrl || (own && c.canCheck)) && (
        <div className="flex flex-wrap items-center gap-x-3 pl-[25px]">
          {c.badgeUrl && (
            <a
              href={c.badgeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 text-[0.78rem] font-[550] text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              See the badge on Credly
              <ExternalLink size={13} {...ICON} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {own && c.canCheck && (
            <button
              ref={button}
              type="button"
              onClick={check}
              aria-disabled={pending || undefined}
              aria-label={`${verified ? "Check again with Credly" : "Check with Credly"}: ${c.name}`}
              className="inline-flex min-h-11 items-center gap-1.5 text-[0.78rem] font-[550] text-muted hover:text-ink aria-disabled:opacity-70"
            >
              <RefreshCw size={14} {...ICON} className={pending ? "motion-safe:animate-spin" : undefined} />
              {pending ? "Checking…" : verified ? "Check again" : "Check with Credly"}
            </button>
          )}
        </div>
      )}
      {own && c.canCheck && (
        <p role="status" className={result ? "pl-[25px] text-[0.76rem] text-ink" : "sr-only"}>
          {result?.message ?? ""}
        </p>
      )}
    </li>
  );
}
