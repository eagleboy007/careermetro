import { ArrowRight, CalendarClock, MessageSquare } from "lucide-react";
import Link from "next/link";
import { prepareHref } from "@/lib/my-jobs/rules";
import { countdownWords, interviewWhen, leadLine } from "@/lib/my-jobs/view";
import type { EventTeaser, NextInterviewView, OnYourLine } from "@/lib/schemas";

const card = "flex min-w-0 flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-4 md:rounded-[20px] md:px-[22px] md:py-5";
const avatar = "grid shrink-0 place-items-center rounded-full font-mono font-medium text-ink";

/**
 * Timetable teaser: the next two events that match the person's goals or interests, near their city or online
 * (docs/plans/timetable-plan.md section 7), with a link to the whole Timetable. Today leaves it out when nothing matches.
 */
export function TimetableTeaser({ events }: { events: EventTeaser[] }) {
  return (
    <section aria-label="Timetable" className={card}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">Timetable</h3>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">near you</span>
        <Link href="/timetable" className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 text-[0.82rem] font-semibold text-ink hover:text-muted">
          All events
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
      <ul className="flex flex-col gap-3">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-3 text-[0.86rem]">
            <span className="flex w-[34px] shrink-0 flex-col items-center rounded-[8px] bg-surface-2 py-1 font-mono text-[0.6rem] uppercase text-muted">
              {e.day}
              <b className="font-display text-[0.95rem] font-semibold leading-tight text-ink">{e.date}</b>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
              {e.title}
              <small className="text-[0.76rem] text-muted">{e.detail}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * People on the same goal right now, from people who chose to be found (src/lib/today/live.ts): a count, up to four
 * initials and, once Junction exists, a tip. "See people" opens Network; Junction comes later (build step 11).
 */
export function OnYourLineCard({ line, firstDay = false, label = "On your line" }: { line: OnYourLine; firstDay?: boolean; label?: string }) {
  const extra = line.count - line.initials.length;
  return (
    <section aria-label={label} className={card}>
      <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">On your line right now</h3>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex" aria-hidden="true">
          {[...line.initials, ...(extra > 0 ? [`+${extra}`] : [])].map((i, n) => (
            <span key={`${i}-${n}`} className={`${avatar} size-[34px] border-2 border-surface bg-surface-2 text-[0.66rem] ${n > 0 ? "-ml-[9px]" : ""}`}>
              {i}
            </span>
          ))}
        </div>
        <p className="min-w-[180px] flex-1 text-[0.86rem]">
          <b className="font-semibold">{line.count === 1 ? "1 person" : `${line.count} people`}</b>{" "}
          {firstDay ? `took on the ${line.goalName} goal this week.` : `${line.count === 1 ? "is" : "are"} on the ${line.goalName} goal with you.`}
        </p>
      </div>
      {!firstDay && line.tip && (
        <div className="flex items-start gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[0.86rem]">
          <span className={`${avatar} size-[30px] bg-surface text-[0.62rem]`} aria-hidden="true">
            {line.tip.initials}
          </span>
          <div>
            &ldquo;{line.tip.quote}&rdquo;
            <small className="mt-0.5 block text-[0.74rem] text-muted">{line.tip.who}</small>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-[11px] py-1.5 text-[0.8rem] font-semibold text-muted">
          <MessageSquare size={16} strokeWidth={1.75} aria-hidden="true" />
          Ask on Junction · soon
        </span>
        <Link href="/network" className="inline-flex min-h-11 items-center gap-1 px-2 text-[0.8rem] font-semibold text-ink hover:text-muted">
          See people
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

/**
 * Today's countdown to an interview in My jobs: the job, `days` worked out on the server in India days, and the job's
 * still-open skills that lead today's ride (C20; empty or absent for none).
 */
export type NextInterview = NextInterviewView & { days: number; leadSkills?: string[] };

/**
 * "Interview in 2 days" (handoff 12m: "Today counts down to it"): the soonest interview the person set in My jobs, with
 * Practice on its skills, the mock interview for it, and My jobs. Neutral colours: cobalt stays for progress, and the
 * card never says anything about the person's chances (C20).
 */
export function NextInterviewCard({ next }: { next: NextInterview }) {
  const lead = leadLine(next.leadSkills ?? []);
  const link = "inline-flex min-h-11 items-center gap-1 px-2 text-[0.8rem] font-semibold text-ink hover:text-muted";
  return (
    <section aria-label="Next interview" className={card}>
      <div className="flex flex-wrap items-center gap-2.5">
        <CalendarClock size={18} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
        <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">Interview {countdownWords(next.days)}</h3>
        <span className="ml-auto font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">My jobs</span>
      </div>
      <p className="text-[0.9rem] [overflow-wrap:anywhere]">
        <b className="font-semibold">{next.title}</b> at {next.company}
        <small className="mt-0.5 block font-mono text-[0.72rem] tracking-[0.04em] text-muted">{interviewWhen(next.interviewAt)} IST</small>
      </p>
      {lead && <p className="text-[0.82rem] text-muted">{lead}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <Link href={prepareHref(next.ref, "practice")} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-2 text-[0.82rem] font-[550] text-ink hover:bg-surface-2">
          Practise its skills
        </Link>
        <Link href={prepareHref(next.ref, "mock")} className={link}>
          Mock interview
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <Link href="/departures?tab=mine" className={link}>
          My jobs
        </Link>
      </div>
    </section>
  );
}
