"use client";

import { Ban, Check } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";

/*
 * Work-email checks to review (FR-47, dev/current-job-check-plan.md), on /admin/companies: a person confirmed a code
 * at a domain that doesn't plainly belong to the company on their current job. The admin says whether it does. Only the
 * company as the person wrote it, the domain and the day: never the person, their address or their profile. Neutral
 * colours; results are announced in a polite live region. Without `review` (the /design page) the buttons are off.
 */

export type JobCheckRowView = { id: string; employer: string; domain: string; checkedAt: Date | string };
export type JobCheckReviewAction = (id: string, decision: "verify" | "refuse") => Promise<{ ok: boolean; message: string }>;

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium disabled:cursor-not-allowed disabled:opacity-60";

export function JobCheckReview({ checks, review }: { checks: JobCheckRowView[]; review?: JobCheckReviewAction }) {
  const [message, setMessage] = useState("");
  const [decided, setDecided] = useState(0);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  // The row decided on leaves the list, so focus goes to the heading instead of dropping to the page.
  useEffect(() => {
    if (decided) heading.current?.focus();
  }, [decided]);
  const decide = (id: string, decision: "verify" | "refuse") =>
    review &&
    start(async () => {
      setMessage("");
      setMessage((await review(id, decision)).message);
      setDecided((n) => n + 1);
    });
  return (
    <section aria-labelledby={headingId} className="mx-auto flex w-full max-w-[920px] flex-col gap-3">
      <h2 ref={heading} id={headingId} tabIndex={-1} className="text-[1.3rem] font-semibold">
        Work-email checks
      </h2>
      <p className="text-[0.9rem] text-muted">
        Someone confirmed a code at this domain for their current job. Verify only if the domain belongs to that company. Refused checks show Not verified,
        and the person can try another email.
      </p>
      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>
      {checks.length === 0 ? (
        <p className="text-[0.9rem] text-muted">No checks waiting.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {checks.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <b className="font-semibold [overflow-wrap:anywhere]">{c.employer}</b>
                <span className="text-[0.86rem] text-muted">
                  <span className="font-mono text-[0.8rem] text-ink [overflow-wrap:anywhere]">@{c.domain}</span> · {formatDay(new Date(c.checkedAt).toISOString().slice(0, 10))}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || !review} onClick={() => decide(c.id, "verify")} aria-label={`Verify @${c.domain} for ${c.employer}`} className={`${button} border-ink bg-ink text-bg hover:opacity-90`}>
                  <Check {...ICON} />
                  Verify
                </button>
                <button type="button" disabled={pending || !review} onClick={() => decide(c.id, "refuse")} aria-label={`Refuse @${c.domain} for ${c.employer}`} className={`${button} border-line bg-surface text-ink hover:bg-surface-2`}>
                  <Ban {...ICON} />
                  Refuse
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
