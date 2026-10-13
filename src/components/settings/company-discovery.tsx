"use client";

import { Building2, Eye } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import type { DiscoveryActions, DiscoveryView } from "@/lib/corporate/find-types";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const ghostSm =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[0.8rem] font-medium text-ink hover:bg-surface-2 disabled:opacity-60";

/**
 * Companies that opened the person's profile from a search in the last 30 days, and the companies they blocked
 * (pending item 19, Settings > Privacy). Blocking is silent: the company is not told, never finds the person again and
 * any chat it started closes. Without actions (example data, /design) the buttons are off.
 */
export function CompanyDiscovery({ data, actions }: { data: DiscoveryView; actions?: DiscoveryActions }) {
  const [blocked, setBlocked] = useState(data.blocked);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const blockedIds = new Set(blocked.map((b) => b.orgId));

  const run = (orgId: string, company: string, block: boolean) => {
    if (!actions) return;
    start(async () => {
      const error = await (block ? actions.block(orgId) : actions.unblock(orgId));
      if (error) setMessage(error);
      else {
        setBlocked((list) => (block ? [{ orgId, company, since: "Today" }, ...list.filter((b) => b.orgId !== orgId)] : list.filter((b) => b.orgId !== orgId)));
        setMessage(block ? `Blocked ${company}. They won't find or message you.` : `Unblocked ${company}.`);
      }
      // The button pressed may be gone now, so focus moves to the line saying what happened, never to the page.
      requestAnimationFrame(() => statusRef.current?.focus());
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-company-discovery>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-[0.82rem] font-semibold">Companies that viewed your profile</h3>
        <small className="text-[0.78rem] text-muted">From their searches in the last 30 days. Older views are deleted.</small>
        {data.views.length ? (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
            {data.views.map((v) => (
              <li key={v.orgId} className="flex flex-wrap items-center gap-3 px-3.5 py-2">
                <span className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-surface-2">
                  <Eye {...ICON} />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[0.9rem] font-semibold [overflow-wrap:anywhere]">{v.company}</b>
                  <small className="block text-[0.78rem] text-muted">
                    {v.times === 1 ? "Viewed once" : `Viewed ${v.times} times`}, last on {v.lastOn}
                  </small>
                </span>
                {blockedIds.has(v.orgId) ? (
                  <span className="text-[0.78rem] text-muted">Blocked</span>
                ) : (
                  <button type="button" className={ghostSm} disabled={!actions || pending} onClick={() => run(v.orgId, v.company, true)}>
                    Block<span className="sr-only"> {v.company}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.82rem] text-muted">No company has viewed your profile in the last 30 days.</p>
        )}
      </div>

      {blocked.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-[0.82rem] font-semibold">Blocked companies</h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
            {blocked.map((b) => (
              <li key={b.orgId} className="flex flex-wrap items-center gap-3 px-3.5 py-2">
                <span className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-surface-2">
                  <Building2 {...ICON} />
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[0.9rem] font-semibold [overflow-wrap:anywhere]">{b.company}</b>
                  <small className="block text-[0.78rem] text-muted">Blocked since {b.since}</small>
                </span>
                <button type="button" className={ghostSm} disabled={!actions || pending} onClick={() => run(b.orgId, b.company, false)}>
                  Unblock<span className="sr-only"> {b.company}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.82rem] text-muted outline-none empty:hidden">
        {message}
      </p>
    </div>
  );
}
