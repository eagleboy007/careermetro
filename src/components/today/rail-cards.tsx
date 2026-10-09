import { ArrowRight, MessageSquare } from "lucide-react";
import type { EventTeaser, OnYourLine } from "@/lib/schemas";

const card = "flex min-w-0 flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-4 md:rounded-[20px] md:px-[22px] md:py-5";
const avatar = "grid shrink-0 place-items-center rounded-full bg-surface-2 font-mono font-medium text-ink";

/** Timetable teaser: the next events for the user's goals. The full Timetable comes later (build step 11). */
export function TimetableTeaser({ events }: { events: EventTeaser[] }) {
  return (
    <section aria-label="Timetable" className={card}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">Timetable</h3>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">near you</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[0.82rem] font-semibold text-muted">
          All events · soon
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-3 text-[0.86rem]">
            <span className="flex w-[34px] shrink-0 flex-col items-center rounded-[8px] bg-surface-2 py-1 font-mono text-[0.6rem] uppercase text-muted">
              {e.day}
              <b className="font-display text-[0.95rem] font-semibold leading-tight text-ink">{e.date}</b>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              {e.title}
              <small className="text-[0.76rem] text-muted">{e.detail}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** People on the same goal right now, from opted-in profiles. Junction and Network come later (build step 11). */
export function OnYourLineCard({ line }: { line: OnYourLine }) {
  const extra = line.count - line.initials.length;
  return (
    <section aria-label="On your line" className={card}>
      <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">On your line right now</h3>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex" aria-hidden="true">
          {[...line.initials, ...(extra > 0 ? [`+${extra}`] : [])].map((i, n) => (
            <span key={`${i}-${n}`} className={`${avatar} size-[34px] border-2 border-surface text-[0.66rem] ${n > 0 ? "-ml-[9px]" : ""}`}>
              {i}
            </span>
          ))}
        </div>
        <p className="min-w-[180px] flex-1 text-[0.86rem]">
          <b className="font-semibold">{line.count === 1 ? "1 person" : `${line.count} people`}</b>{" "}
          {line.count === 1 ? "is" : "are"} on the {line.goalName} goal with you.
        </p>
      </div>
      {line.tip && (
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
        <span className="px-2 text-[0.8rem] font-semibold text-muted">See people · soon</span>
      </div>
    </section>
  );
}
