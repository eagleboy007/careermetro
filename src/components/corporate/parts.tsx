import { Ban, Clock, FlaskConical, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { daysText } from "@/lib/corporate/format";
import type { OrgReviewStatus } from "@/lib/corporate/types";
import { ANTI_SCAM_LINE, ORG_STATUS_LABELS } from "@/lib/schemas/constants";

/*
 * Small pieces of the Corporate screens (handoff 12e and 12f). Neutral colours only: cobalt means progress and
 * red, amber and green mean gap status, so a company's status is told by its words and icon.
 */

export const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/** A text field without a width, for fields that sit in a row. */
export const inputClass = "rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-[0.92rem] text-ink";
export const fieldClass = `w-full ${inputClass}`;
export const labelClass = "flex flex-col gap-1.5 text-[0.82rem] font-semibold";
export const hintClass = "text-[0.78rem] font-normal text-muted";
export const ghostSm = "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.8rem] font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";

const STATUS_ICON = { pending: Clock, verified: ShieldCheck, suspended: Ban } as const;

/** "Waiting for verification", "Verified company" or "Suspended". */
export function OrgStatusBadge({ status }: { status: OrgReviewStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
        status === "verified" ? "border border-ink/20 bg-surface-2 text-ink" : "bg-surface-2 text-muted"
      }`}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      {ORG_STATUS_LABELS[status]}
    </span>
  );
}

/** The code on screen while no email sender exists (dev/corporate-plan.md). Never shown in production. */
export function TestCodeBox({ code }: { code: string }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line bg-surface-2 px-3.5 py-2.5">
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
        <FlaskConical {...ICON} />
        Test mode
      </span>
      <span className="text-[0.84rem] text-muted">No email is sent here. Your code is</span>
      <b className="font-mono text-[1.05rem] tracking-[0.3em]" data-test-code={code}>
        {code}
      </b>
    </div>
  );
}

/** The anti-scam line on every company screen. */
export function AntiScamLine() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.84rem] text-muted">
      <ShieldAlert {...ICON} className="mt-0.5 shrink-0" />
      <span>{ANTI_SCAM_LINE}</span>
    </p>
  );
}

/** The admin rule's banner (Milin, 2026-10-12): while a company has one Recruiter admin, with the days left. */
export function SecondAdminBanner({ daysLeft, action }: { daysLeft: number; action?: ReactNode }) {
  return (
    <div role="note" className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-surface-2">
        <UserPlus {...ICON} />
      </span>
      <div className="min-w-0 flex-1">
        <b className="text-[0.92rem] font-semibold">Add a second admin</b>
        <p className="text-[0.82rem] text-muted">
          {daysLeft > 0
            ? `Every company keeps at least two Recruiter admins so it is never locked out. ${daysText(daysLeft)} left; after that, no new jobs can open until a second admin joins.`
            : "Every company keeps at least two Recruiter admins. No new jobs can open until a second admin joins."}
        </p>
      </div>
      {action}
    </div>
  );
}

/** A card section with a heading, as on Account settings. */
export function Panel({ id, title, tag, children }: { id: string; title: string; tag?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-20 flex-col gap-4 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 id={`${id}-h`} className="mr-auto text-[1.1rem] font-semibold">
          {title}
        </h2>
        {tag && <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">{tag}</span>}
      </div>
      {children}
    </section>
  );
}
