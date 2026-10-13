"use client";

import { ArrowLeft, CalendarCheck, CalendarClock, LayoutGrid, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { CompanyInterviewsView, InterviewActions, SchedulerActions, SchedulerView } from "@/lib/corporate/types";
import { INTERVIEW_MINUTES, ORG_ROLE_LABELS } from "@/lib/schemas/constants";
import { InterviewCard } from "./interview-parts";
import { monoLabel } from "./job-parts";
import { actionBtn, inkBtn } from "./jobs-panel";
import { ICON } from "./parts";

/*
 * Corporate Interviews (dev/corporate-plan.md build step 6; C7 Interviews), at `/corporate/interviews`: the
 * interviews the person may see, soonest first. With `?application=…` it is the scheduler: the candidate's offered
 * times on a week grid, a length, and interviewers from the job's team, each with their own interviews shown as busy
 * (never whose). Times are India time. Without `actions` (the /design page and the example) nothing changes.
 */

type Note = { text: string; error: boolean } | null;

function Notice({ note }: { note: Note }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (note) ref.current?.focus();
  }, [note]);
  if (!note) return null;
  return (
    <p ref={ref} tabIndex={-1} role={note.error ? "alert" : "status"} className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
      {note.text}
    </p>
  );
}

/** The list of interviews, by day. */
export function CompanyInterviews({ view, actions, note }: { view: CompanyInterviewsView; actions?: InterviewActions; note?: React.ReactNode }) {
  const [message, setMessage] = useState<Note>(null);
  const days = [...new Set(view.items.map((i) => i.day))];
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <Link href="/corporate" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] text-muted hover:text-ink">
          <ArrowLeft {...ICON} />
          Corporate
        </Link>
        <span className={monoLabel}>Corporate · {view.company}</span>
        <h1 className="text-[clamp(1.5rem,3.2vw,2rem)] font-semibold leading-[1.1]">Interviews</h1>
        <p className="max-w-[680px] text-[0.9rem] text-muted">
          {view.role === "interviewer"
            ? "The interviews you are on. Open the candidate to read their profile and chat, and write your feedback after."
            : "Interviews on your jobs, India time. Ask for times from a candidate's drawer or chat, then book one of the times they offer."}
        </p>
      </div>
      {note}
      <Notice note={message} />
      {view.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-5 text-[0.9rem] text-muted">No interviews in the past week or ahead.</p>
      ) : (
        days.map((day) => {
          const items = view.items.filter((i) => i.day === day);
          return (
            <section key={day} aria-labelledby={`iv-${day}`} className="flex flex-col gap-2.5">
              <h2 id={`iv-${day}`} className="text-[1.05rem] font-semibold">
                {items[0]!.when.slice(0, -7)}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {items.map((iv) => (
                  <li key={iv.id}>
                    <InterviewCard
                      iv={iv}
                      actions={actions}
                      onDone={(text, error) => setMessage({ text, error })}
                      heading={
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <b className="block text-[0.95rem] [overflow-wrap:anywhere]">{iv.candidate}</b>
                            <span className="text-[0.8rem] text-muted [overflow-wrap:anywhere]">
                              {iv.job}
                              {iv.assigned ? " · You are interviewing" : ""}
                            </span>
                          </div>
                          <Link href={`/corporate/jobs/board?id=${iv.jobId}`} className={actionBtn}>
                            <LayoutGrid {...ICON} />
                            Board
                          </Link>
                          <Link href={`/corporate/messages?application=${iv.applicationId}`} className={actionBtn}>
                            <MessageSquare {...ICON} />
                            Chat
                          </Link>
                        </div>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

/** The scheduler for one application. */
export function Scheduler({ view, actions, note }: { view: SchedulerView; actions?: SchedulerActions; note?: React.ReactNode }) {
  const [slotId, setSlotId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number>(45);
  const [chosen, setChosen] = useState<string[]>([]);
  const [message, setMessage] = useState<Note>(null);
  const [pending, start] = useTransition();
  const ids = useId();
  const slot = view.slots.find((s) => s.id === slotId) ?? null;
  const busyAt = (key: string) => view.team.filter((t) => chosen.includes(t.memberId) && t.busyKeys.includes(key));
  const clash = slot ? busyAt(slot.key) : [];
  const first = view.candidate.trim().split(/\s+/)[0] ?? view.candidate;

  const book = () => {
    if (!slot) return setMessage({ text: "Pick one of the times they offered.", error: true });
    if (!chosen.length) return setMessage({ text: "Pick at least one interviewer.", error: true });
    if (clash.length) return setMessage({ text: `${clash.map((c) => c.name).join(", ")} already has an interview then. Pick another time or interviewer.`, error: true });
    start(async () => {
      if (!actions) return setMessage({ text: "Example scheduler. Nothing is booked here.", error: true });
      const problem = await actions.schedule({ applicationId: view.applicationId, slotId: slot.id, minutes, interviewers: chosen });
      if (problem) return setMessage({ text: problem, error: true });
      setSlotId(null);
      setChosen([]);
      setMessage({ text: `Booked ${slot.label}. ${first} answers on Arrivals; you'll see it here.`, error: false });
    });
  };
  const askTimes = () =>
    start(async () => {
      if (!actions) return setMessage({ text: "Example scheduler. Nothing is sent here.", error: true });
      const problem = await actions.askTimes(view.applicationId);
      setMessage(problem ? { text: problem, error: true } : { text: `Asked ${first} for times in Messages.`, error: false });
    });

  const canBook = !view.refusal;
  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <Link href={`/corporate/jobs/board?id=${view.jobId}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] text-muted hover:text-ink">
          <ArrowLeft {...ICON} />
          {view.job}
        </Link>
        <span className={monoLabel}>Corporate · {view.company} · Interviews</span>
        <h1 className="text-[clamp(1.5rem,3.2vw,2rem)] font-semibold leading-[1.1] [overflow-wrap:anywhere]">Schedule {view.candidate}</h1>
        <p className="max-w-[680px] text-[0.9rem] text-muted">
          The times {first} offered, India time. Each is an hour; the interview can be shorter. Interviewers&apos; own interviews show as busy, never whose.
        </p>
      </div>
      {note}
      {view.refusal && (
        <p role="note" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.88rem]">
          {view.refusal}
        </p>
      )}
      <Notice note={message} />

      {view.slots.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line p-5">
          <p className="text-[0.92rem]">{view.waitingForTimes ? `Waiting for ${first} to pick times.` : `${first} has no offered times still ahead.`}</p>
          {canBook && !view.waitingForTimes && (
            <button type="button" className={actionBtn} disabled={pending} onClick={askTimes}>
              <CalendarClock {...ICON} />
              Ask for times
            </button>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            book();
          }}
        >
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1.5 text-[0.95rem] font-semibold">Pick a time</legend>
            <div className="overflow-x-auto">
              <div
                role="radiogroup"
                aria-label="Offered times"
                className="grid min-w-0 gap-1 text-[0.74rem]"
                style={{ gridTemplateColumns: `44px repeat(${view.days.length}, minmax(0, 1fr))` }}
              >
                <span />
                {view.days.map(({ day, label: [wd, date] }) => (
                  <span key={day} className="p-0.5 text-center font-mono leading-[1.3] text-muted">
                    {wd}
                    <br />
                    {date}
                  </span>
                ))}
                {view.times.map((time) => (
                  <Row key={time} time={time} view={view} slotId={slotId} onPick={setSlotId} busyAt={busyAt} disabled={!canBook} />
                ))}
              </div>
            </div>
            <p className="text-[0.78rem] text-muted">Empty cells weren&apos;t offered. Striped cells are booked already.</p>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[0.95rem] font-semibold">Length</legend>
            <div className="flex flex-wrap gap-2">
              {INTERVIEW_MINUTES.map((m) => (
                <label key={m} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[0.86rem] ${minutes === m ? "border-ink font-semibold" : "border-line"}`}>
                  <input type="radio" name={`${ids}-len`} checked={minutes === m} onChange={() => setMinutes(m)} className="size-4 accent-ink" disabled={!canBook} />
                  {m} min
                </label>
              ))}
            </div>
            <p className="text-[0.78rem] text-muted">Round: Level 2 team. The L1 AI round isn&apos;t available yet.</p>
          </fieldset>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[0.95rem] font-semibold">Interviewers</legend>
            <ul className="flex flex-col gap-1.5">
              {view.team.map((t) => {
                const busyNow = slot ? t.busyKeys.includes(slot.key) : false;
                return (
                  <li key={t.memberId}>
                    <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-line px-3 py-2 text-[0.88rem]">
                      <input
                        type="checkbox"
                        className="size-4 accent-ink"
                        disabled={!canBook}
                        checked={chosen.includes(t.memberId)}
                        onChange={(e) => setChosen((c) => (e.target.checked ? [...c, t.memberId] : c.filter((x) => x !== t.memberId)))}
                      />
                      <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{t.name}</span>
                      <span className="text-[0.78rem] text-muted">
                        {ORG_ROLE_LABELS[t.role]} · {t.thisWeek} {t.thisWeek === 1 ? "interview" : "interviews"} this week
                        {busyNow ? " · Busy at this time" : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={inkBtn} disabled={pending || !canBook}>
              <CalendarCheck {...ICON} />
              Book interview
            </button>
            <span className="text-[0.8rem] text-muted">{slot ? `${slot.label}, ${minutes} min` : "No time picked yet."}</span>
          </div>
        </form>
      )}

      {view.teamWeek.length > 0 && (
        <section aria-labelledby={`${ids}-week`} className="flex flex-col gap-2">
          <h2 id={`${ids}-week`} className="text-[1rem] font-semibold">
            The team&apos;s next 7 days
          </h2>
          <ul className="flex flex-col gap-1 text-[0.84rem]">
            {view.teamWeek.map((w, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-[0.76rem] text-muted">{w.when}</span>
                <span>{w.who}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.interviews.length > 0 && (
        <section aria-labelledby={`${ids}-booked`} className="flex flex-col gap-2">
          <h2 id={`${ids}-booked`} className="text-[1rem] font-semibold">
            Booked for {first}
          </h2>
          <ul className="flex flex-col gap-2.5">
            {view.interviews.map((iv) => (
              <li key={iv.id}>
                <InterviewCard
                  iv={iv}
                  actions={actions}
                  onDone={(text, error) => setMessage({ text, error })}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({
  time,
  view,
  slotId,
  onPick,
  busyAt,
  disabled,
}: {
  time: string;
  view: SchedulerView;
  slotId: string | null;
  onPick: (id: string) => void;
  busyAt: (key: string) => { name: string }[];
  disabled: boolean;
}) {
  return (
    <>
      <span className="flex min-h-11 items-center font-mono text-muted">{time}</span>
      {view.days.map(({ day }) => {
        const s = view.slots.find((x) => x.day === day && x.time === time);
        if (!s) return <span key={day} aria-hidden className="min-h-11 rounded-[7px] border border-dashed border-line/60" />;
        const busy = busyAt(s.key);
        const picked = slotId === s.id;
        return (
          <button
            key={day}
            type="button"
            role="radio"
            aria-checked={picked}
            disabled={s.taken || disabled}
            aria-label={`${s.label}${s.taken ? ", booked" : ""}${busy.length ? `, ${busy.map((b) => b.name).join(" and ")} busy` : ""}`}
            onClick={() => onPick(s.id)}
            className="min-h-11 rounded-[7px] border border-line bg-surface-2 text-[0.72rem] font-medium text-ink aria-checked:border-ink aria-checked:bg-ink aria-checked:text-surface disabled:cursor-not-allowed disabled:bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_5px,transparent_5px_10px)] disabled:text-muted"
          >
            {s.taken ? "booked" : picked ? "✓" : busy.length ? "busy" : "open"}
          </button>
        );
      })}
    </>
  );
}
