"use client";

import { CalendarClock, CalendarPlus, Phone, PhoneOff, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { actionBtn, inkBtn } from "@/components/corporate/jobs-panel";
import { fieldClass, hintClass, ICON } from "@/components/corporate/parts";
import { interviewIcs } from "@/lib/calendar/ics";
import { dayParts, nextDays } from "@/lib/corporate/slots";
import type { ArrivalsActions, MyApplicationView, MyInterviewView } from "@/lib/corporate/types";
import { INTERVIEW_ROUND_LABELS, INTERVIEW_STATUS_LABELS } from "@/lib/schemas/constants";

/*
 * Interviews on Arrivals (handoff section 9; dev/corporate-plan.md build step 6): "Next up" for the nearest interview,
 * a 10-day strip, and each interview on its application with Accept and Decline. Accepting, the person may choose to
 * share a phone with that interview's team; it is never shared otherwise, and "Stop sharing" erases it. `today` is the
 * India date worked out on the server, so nothing here reads the clock while rendering.
 */

const UPCOMING = new Set(["proposed", "accepted"]);
type Notice = (m: { error: boolean; text: string }) => void;

/** Interviews still ahead, soonest first, with their application. */
export function upcomingInterviews(applications: MyApplicationView[], today: string) {
  return applications
    .filter((a) => !a.withdrawn)
    .flatMap((a) => a.interviews.filter((i) => UPCOMING.has(i.status) && i.day >= today).map((i) => ({ app: a, interview: i })))
    .sort((x, y) => (x.interview.day + x.interview.when.slice(-5)).localeCompare(y.interview.day + y.interview.when.slice(-5)));
}

/** "Next up" and the 10-day strip. Nothing shows when no interview is ahead. */
export function NextUp({ applications, today }: { applications: MyApplicationView[]; today: string }) {
  const ahead = upcomingInterviews(applications, today);
  const next = ahead[0];
  if (!next) return null;
  const days = nextDays(today, 10);
  const count = (day: string) => ahead.filter((x) => x.interview.day === day).length;
  return (
    <section aria-labelledby="arr-next" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
        <span id="arr-next" className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">
          Next up
        </span>
        <div className="flex flex-wrap items-start gap-3">
          <CalendarClock {...ICON} size={22} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-[1.15rem] font-semibold leading-[1.2]">
              {next.interview.when.slice(0, -7)}, {next.interview.range}
            </p>
            <p className="mt-0.5 text-[0.9rem] [overflow-wrap:anywhere]">
              {INTERVIEW_ROUND_LABELS[next.interview.round]} interview for {next.app.title} at {next.app.company}
            </p>
            <p className="mt-0.5 text-[0.82rem] text-muted">
              {next.interview.status === "proposed" ? "Waiting for your answer below." : "Accepted. Times are India time."}
            </p>
          </div>
        </div>
      </div>
      <ol aria-label="The next 10 days" className="grid grid-cols-5 gap-1.5 min-[560px]:grid-cols-10">
        {days.map((day, i) => {
          const n = count(day);
          const [wd, date] = dayParts(day);
          return (
            <li
              key={day}
              aria-label={`${i === 0 ? "Today, " : ""}${wd} ${date}: ${n ? `${n} ${n === 1 ? "interview" : "interviews"}` : "nothing booked"}`}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border px-1 py-2 ${n ? "border-accent bg-accent-soft" : "border-line bg-surface"}`}
            >
              <span aria-hidden className="font-mono text-[0.66rem] uppercase text-muted">
                {i === 0 ? "Today" : wd}
              </span>
              <span aria-hidden className="text-[0.88rem] font-semibold">
                {date.split(" ")[0]}
              </span>
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${n ? "bg-accent" : "bg-transparent"}`} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The interviews on one application, with Accept and Decline, and the phone the person shared. */
export function ApplicationInterviews({ app, actions, onDone }: { app: MyApplicationView; actions?: Omit<ArrivalsActions, "withdraw">; onDone: Notice }) {
  const [pending, start] = useTransition();
  if (!app.interviews.length && !app.phoneShared) return null;
  return (
    <div className="flex flex-col gap-2">
      {app.interviews.length > 0 && (
        <>
          <h4 className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Interviews</h4>
          <ul className="flex flex-col gap-2">
            {app.interviews.map((iv) => (
              <li key={iv.id}>
                <InterviewRow app={app} iv={iv} respond={actions?.respond} onDone={onDone} />
              </li>
            ))}
          </ul>
        </>
      )}
      {app.phoneShared && (
        <div className="flex flex-wrap items-center gap-2 text-[0.84rem]">
          <Phone {...ICON} className="text-muted" />
          <span className="min-w-0 flex-1">
            Your phone is shared with {app.company}&apos;s Recruiter admins, Hiring HR on this job, and the interviewers of the interview you shared it for,
            while your application is open. No one else sees it.
          </span>
          <button
            type="button"
            className={actionBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!actions) return onDone({ error: true, text: "Example applications. Nothing changes here." });
                const problem = await actions.stopSharing(app.id);
                onDone(problem ? { error: true, text: problem } : { error: false, text: `Your phone is no longer shared with ${app.company}.` });
              })
            }
          >
            <PhoneOff {...ICON} />
            Stop sharing
          </button>
        </div>
      )}
    </div>
  );
}

function InterviewRow({ app, iv, respond, onDone }: { app: MyApplicationView; iv: MyInterviewView; respond?: ArrivalsActions["respond"]; onDone: Notice }) {
  const [accepting, setAccepting] = useState(false);
  const [share, setShare] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const id = useId();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const shareRef = useRef<HTMLInputElement>(null);
  const was = useRef(false);
  useEffect(() => {
    // Opening the form puts focus on the choice to share; Not now puts it back on Accept.
    if (accepting) shareRef.current?.focus();
    else if (was.current) acceptRef.current?.focus();
    was.current = accepting;
  }, [accepting]);
  const answer = (kind: "accept" | "decline") =>
    start(async () => {
      if (!respond) return onDone({ error: true, text: "Example applications. Nothing changes here." });
      const problem = await respond({ interviewId: iv.id, answer: kind, sharePhone: kind === "accept" && share, phone: kind === "accept" && share ? phone : "" });
      if (problem) return onDone({ error: true, text: problem });
      setAccepting(false);
      onDone({ error: false, text: kind === "accept" ? `Accepted: ${iv.when}, ${app.company}.` : `Declined: ${iv.when}, ${app.company}.` });
    });
  const live = iv.status === "proposed" || iv.status === "accepted";
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-2 px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.86rem]">
        <span className="font-medium">
          {iv.when.slice(0, -7)}, {iv.range}
        </span>
        <span className="text-muted">
          {INTERVIEW_ROUND_LABELS[iv.round]} · {iv.minutes} min
        </span>
        <span className={`ml-auto text-[0.8rem] ${live ? "text-ink" : "text-muted"}`}>{iv.status === "proposed" && iv.canRespond ? "Waiting for your answer" : INTERVIEW_STATUS_LABELS[iv.status]}</span>
      </div>
      {live && <PracticeRound />}
      {iv.status === "accepted" && <AddToCalendar app={app} iv={iv} />}
      {iv.canRespond && !accepting && (
        <div className="flex flex-wrap gap-2">
          <button ref={acceptRef} type="button" className={inkBtn} disabled={pending} onClick={() => setAccepting(true)} aria-label={`Accept the interview on ${iv.when}`}>
            Accept
          </button>
          <button type="button" className={actionBtn} disabled={pending} onClick={() => answer("decline")} aria-label={`Decline the interview on ${iv.when}`}>
            Decline
          </button>
        </div>
      )}
      {iv.canRespond && accepting && (
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            answer("accept");
          }}
        >
          <label className="flex min-h-11 items-center gap-2.5 text-[0.86rem]">
            <input ref={shareRef} type="checkbox" className="size-5 shrink-0 accent-ink" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>
              Share my phone with {app.company}&apos;s Recruiter admins, Hiring HR on this job, and this interview&apos;s interviewers (until a week after it), while
              your application is open.
            </span>
          </label>
          {share && (
            <label htmlFor={`${id}-phone`} className="flex flex-col gap-1.5 text-[0.82rem] font-semibold">
              Mobile number
              <input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel" required className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
              <span className={hintClass}>No one else sees it. It is erased when you stop sharing or withdraw, or if {app.company} closes your application.</span>
            </label>
          )}
          {!share && <p className={hintClass}>Your phone stays private. The company can reach you in Messages.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={inkBtn} disabled={pending}>
              Accept interview
            </button>
            <button type="button" className={actionBtn} disabled={pending} onClick={() => setAccepting(false)}>
              Not now
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The practice round before an interview (handoff 12l, C15): Interview prep's mock interview, which is Elite. */
export function PracticeRound() {
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8rem] text-muted">
      <Link href="/mock" className="inline-flex min-h-11 items-center gap-1.5 font-[550] text-ink hover:text-muted">
        <Play {...ICON} size={14} />
        <span className="underline underline-offset-2">Practice round</span>
        <span className="rounded-full bg-elite px-1.5 py-px font-mono text-[0.6rem] uppercase tracking-[0.06em] text-on-elite">Elite</span>
      </Link>
      <span>A mock interview with an AI interviewer, on your role&apos;s questions.</span>
    </p>
  );
}

/**
 * "Add to calendar" on an accepted interview (v44 gap list item 46): a calendar file made here in the browser, with the
 * round, job title and company only, and a reminder the evening before. The app can't put it in a calendar itself, so
 * the line says it is a download.
 */
export function AddToCalendar({ app, iv }: { app: Pick<MyApplicationView, "title" | "company">; iv: Pick<MyInterviewView, "id" | "round" | "startsAt" | "minutes" | "when"> }) {
  const download = () => {
    const ics = interviewIcs({
      interviewId: iv.id,
      startsAt: new Date(iv.startsAt),
      minutes: iv.minutes,
      summary: `${INTERVIEW_ROUND_LABELS[iv.round]} interview for ${app.title} at ${app.company}`,
      now: new Date(),
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "careermetro-interview.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8rem] text-muted">
      <button type="button" className={actionBtn} onClick={download} aria-label={`Add to calendar: the interview on ${iv.when}`}>
        <CalendarPlus {...ICON} />
        Add to calendar
      </button>
      <span>Download a calendar file with a reminder the evening before.</span>
    </p>
  );
}
