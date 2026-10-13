import { ScrollText } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AuditLineView, AuditOnView, AuditWhoView, CompanyAuditView } from "@/lib/corporate/types";
import { ORG_ROLE_LABELS } from "@/lib/schemas/constants";
import { ICON } from "./parts";

/*
 * The company's audit view (dev/corporate-plan.md, "Audit"; build step 7), Recruiter admins only. Read only: who did
 * what to which job, application, member or role in waiting. An application is named by its short id and job title,
 * never by the candidate's name or contact details.
 */

function whoText(who: AuditWhoView): string {
  switch (who.kind) {
    case "member":
      return `${who.name} · ${ORG_ROLE_LABELS[who.role]}`;
    case "candidate":
      return "The candidate";
    case "system":
      return "CareerMetro";
    default:
      return "A former team member";
  }
}

function onText(on: AuditOnView): string {
  switch (on.kind) {
    case "company":
      return on.name;
    case "member":
      return on.role ? `${on.name} · ${ORG_ROLE_LABELS[on.role]}` : on.name;
    case "invite":
      return [on.role ? ORG_ROLE_LABELS[on.role] : "Access", on.domain ? `on ${on.domain}` : null].filter(Boolean).join(" ");
    case "job":
      return on.title ? `${on.title} (job ${on.ref})` : `Job ${on.ref}`;
    case "application":
      return on.job ? `Application ${on.ref} · ${on.job}` : `Application ${on.ref}`;
  }
}

function Line({ line }: { line: AuditLineView }) {
  return (
    <li className="grid gap-1 py-3 first:pt-0 last:pb-0 min-[760px]:grid-cols-[150px_minmax(0,1fr)] min-[760px]:gap-4">
      <span className="font-mono text-[0.75rem] text-muted">{line.at}</span>
      <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
        <span className="text-[0.9rem]">
          <b className="font-semibold">{whoText(line.who)}</b> {line.action.charAt(0).toLowerCase() + line.action.slice(1)}
        </span>
        <span className="text-[0.82rem] text-muted">{onText(line.on)}</span>
      </span>
    </li>
  );
}

/** The list, newest first, with a link to older lines. `olderHref` is null on the last page. */
export function CompanyAudit({ view, olderHref, note }: { view: CompanyAuditView; olderHref: string | null; note?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      {note}
      <div>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Corporate · {view.company} · admins only</span>
        <h1 className="mt-1.5 flex items-center gap-2 text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">
          <ScrollText {...ICON} size={24} />
          Audit
        </h1>
        <p className="mt-1.5 max-w-[640px] text-[0.92rem] text-muted">
          Who on your team did what, and when: roles, jobs, candidates opened, moves and interviews. It names applications by number and job, never the
          candidate&apos;s contact details, and nothing anyone wrote.
        </p>
      </div>
      <section aria-label="Audit lines" className="rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
        {view.lines.length ? (
          <ol className="flex flex-col divide-y divide-line">
            {view.lines.map((line) => (
              <Line key={line.id} line={line} />
            ))}
          </ol>
        ) : (
          <p className="text-[0.9rem] text-muted">Nothing yet. Each change to your team, jobs and applications shows here.</p>
        )}
      </section>
      <div className="flex flex-wrap gap-3">
        {olderHref && (
          <Link href={olderHref} className="inline-flex min-h-11 items-center text-ink underline underline-offset-2">
            Older lines
          </Link>
        )}
        <Link href="/corporate" className="inline-flex min-h-11 items-center text-ink underline underline-offset-2">
          Back to Corporate
        </Link>
      </div>
    </div>
  );
}
