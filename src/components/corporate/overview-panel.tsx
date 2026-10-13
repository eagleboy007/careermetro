import { BriefcaseBusiness, CalendarClock, MessageSquare, UserPlus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { CompanyOverviewView } from "@/lib/corporate/types";
import { APPLICATION_STAGE_LABELS, APPLICATION_STAGES } from "@/lib/schemas/constants";
import { ICON, Panel } from "./parts";

/*
 * Corporate Overview (dev/corporate-plan.md, "Inside Corporate"; build step 7): four counts and the open jobs with
 * their applications per lane. Counts only, never a name. Neutral colours: these are counts, not progress or gap
 * status, so nothing here is cobalt, red, amber or green.
 */

function Stat({ icon, label, value, sub, href }: { icon: ReactNode; label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-mono text-[0.68rem] uppercase tracking-[0.06em] text-muted">
        {icon}
        {label}
      </span>
      <span className="font-display text-[1.6rem] font-semibold leading-none tabular-nums">{value}</span>
      {sub && <span className="text-[0.78rem] text-muted">{sub}</span>}
    </>
  );
  const box = "flex min-h-11 min-w-0 flex-col gap-1.5 rounded-md border border-line bg-surface-2 p-3";
  return href ? (
    <Link href={href} className={`${box} hover:border-ink/30`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function OverviewPanel({ view }: { view: CompanyOverviewView }) {
  const who = view.assignedOnly ? "Only the candidates you interview." : "Applications made on CareerMetro, as you can see them.";
  return (
    <Panel id="overview" title="Overview" tag={view.assignedOnly ? "your candidates" : undefined}>
      <p className="-mt-2 text-[0.86rem] text-muted">{who}</p>
      <div className="grid grid-cols-2 gap-2.5 min-[760px]:grid-cols-4">
        <Stat icon={<BriefcaseBusiness {...ICON} size={14} />} label="Open jobs" value={String(view.openJobs)} />
        <Stat icon={<UserPlus {...ICON} size={14} />} label="New" value={String(view.newApplications)} sub="applications in 7 days" />
        <Stat
          icon={<CalendarClock {...ICON} size={14} />}
          label="Interviews"
          value={String(view.interviewsThisWeek)}
          sub={`this week · ${view.interviewsToday} today`}
          href="/corporate/interviews"
        />
        <Stat
          icon={<MessageSquare {...ICON} size={14} />}
          label="Unread"
          value={String(view.unreadChats)}
          sub={view.unreadChats === 1 ? "chat" : "chats"}
          href="/corporate/messages"
        />
      </div>
      {view.jobs.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {view.jobs.map((job) => (
            <li key={job.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <Link href={`/corporate/jobs/board?id=${job.id}`} className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 [overflow-wrap:anywhere]">
                  {job.title}
                </Link>
                <span className="text-[0.82rem] text-muted">
                  {job.city}
                  {job.status === "paused" ? " · Paused" : ""} · {plural(job.total, view.assignedOnly ? "candidate" : "application", view.assignedOnly ? "candidates" : "applications")}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-1.5 min-[760px]:grid-cols-6" aria-label={`${job.title}: applications per stage`}>
                {APPLICATION_STAGES.map((stage) => (
                  <div key={stage} className="flex min-w-0 flex-col rounded-sm border border-line px-2 py-1.5">
                    <dt className="truncate text-[0.7rem] text-muted">{APPLICATION_STAGE_LABELS[stage]}</dt>
                    <dd className="font-mono text-[0.95rem] tabular-nums">{job.lanes[stage]}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.86rem] text-muted">No open jobs yet. Jobs you open, or are on the team of, show here with their applications per stage.</p>
      )}
    </Panel>
  );
}
