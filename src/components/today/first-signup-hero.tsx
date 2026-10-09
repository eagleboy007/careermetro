"use client";

import { Check, Route } from "lucide-react";
import { useEffect, useState } from "react";
import type { FirstSignup, Ride } from "@/lib/schemas/today";
import { WEEKLY_HOURS, DEFAULT_WEEKLY_HOURS } from "@/lib/schemas";
import { weeksAt } from "@/lib/today/logic";
import { TaskList } from "./task-list";

/**
 * First sign-up (handoff 4): a count-up of what the resume showed, the first ride, and three setup taps.
 * The setup choices are local for now; saving them needs the profile fields in handoff section 13.
 */
export function FirstSignupHero({
  firstName,
  destination,
  summary,
  ride,
}: {
  firstName: string;
  destination: string;
  summary: FirstSignup;
  ride: Ride;
}) {
  const [hours, setHours] = useState<number>(DEFAULT_WEEKLY_HOURS);
  const [findable, setFindable] = useState(false);
  const [jobSearch, setJobSearch] = useState(true);
  const minutes = ride.tasks.reduce((sum, t) => sum + t.minutes, 0);

  return (
    <section
      aria-label="Welcome"
      className="grid min-w-0 gap-7 rounded-[24px] border border-line bg-surface px-5 pb-6 pt-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="flex min-w-0 flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-semibold">
            <Route size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
            Day 1
          </span>
          <span className="font-mono text-[0.72rem] uppercase tracking-wider text-muted">Signed up just now · resume read</span>
        </div>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
          Welcome aboard, {firstName}. <em className="not-italic text-accent">Your line is drawn.</em>
        </h2>
        <p className="max-w-[52ch] text-[0.95rem] text-muted">
          We read your resume against {destination}. Here is where you stand, and your first ride is ready.
        </p>
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tally to={summary.skillsFound} label="skills you already have" tone="text-good" />
          <Tally to={summary.gaps} label="gaps to close" tone="text-bad" />
          <Tally to={summary.goals} label="goals on your line" tone="text-accent" />
          <Tally to={summary.rolesBoardingNow} label={summary.rolesBoardingNow === 1 ? "role you could board today" : "roles you could board today"} tone="text-ink" />
        </dl>
        <h3 className="text-[1.05rem] font-semibold">
          Your first ride · Pitstop {ride.pitstop.number}, about {minutes} min
        </h3>
        <TaskList tasks={ride.tasks} />
      </div>

      <div className="flex min-w-0 flex-col gap-3 border-line lg:border-l lg:pl-7">
        <span className="font-mono text-[0.72rem] uppercase tracking-wider text-muted">Set up in three taps</span>
        <ol className="flex flex-col gap-4 text-[0.88rem]">
          <SetupStep n={1} done title="Resume read">
            <small className="text-muted">
              {summary.skillsFound} skills found, {summary.gaps} gaps, all with evidence
            </small>
          </SetupStep>
          <SetupStep n={2} title="Hours a week for learning">
            <div role="group" aria-label="Hours a week" className="mt-1.5 flex flex-wrap gap-1">
              {WEEKLY_HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={h === hours}
                  onClick={() => setHours(h)}
                  className="rounded-full border border-line px-3 py-1 text-[0.78rem] font-medium text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink"
                >
                  {h} h
                </button>
              ))}
            </div>
            <small className="mt-1 block text-muted" aria-live="polite">
              At {hours} hours a week your line takes about {weeksAt(hours, summary.lineHours)} weeks.
            </small>
          </SetupStep>
          <SetupStep n={3} title="Let people on your line find you">
            <Switch checked={findable} onChange={setFindable} label="Show me in people lists" />
            <small className="mt-1 block text-muted">Off by default. Name and status only; never your resume.</small>
          </SetupStep>
          <SetupStep n={4} title="Looking for a job?">
            <Switch checked={jobSearch} onChange={setJobSearch} label="Show me roles I could board" />
            <small className="mt-1 block text-muted">Off hides Departures. Your ride keeps going either way.</small>
          </SetupStep>
        </ol>
      </div>
    </section>
  );
}

function Tally({ to, label, tone }: { to: number; label: string; tone: string }) {
  const [n, setN] = useState(to);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || to === 0) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [to]);
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-surface-2 px-3.5 py-3">
      <dd className={`font-display text-[1.9rem] font-semibold leading-none tabular-nums ${tone}`}>
        <span aria-hidden="true">{n}</span>
        <span className="sr-only">{to}</span>
      </dd>
      <dt className="text-[0.78rem] text-muted">{label}</dt>
    </div>
  );
}

function SetupStep({ n, done = false, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      <span
        className={`grid size-6 place-items-center rounded-full font-mono text-[0.7rem] ${done ? "bg-accent text-on-accent" : "border border-line text-muted"}`}
      >
        {done ? <Check size={13} strokeWidth={1.75} aria-hidden="true" /> : n}
      </span>
      <div className="min-w-0">
        <b className="block font-medium">{title}</b>
        {children}
      </div>
    </li>
  );
}

/** A plain on/off switch. Ghost style: these are settings, not progress. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <label className="mt-1.5 inline-flex cursor-pointer items-center gap-2 text-[0.84rem]">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-line transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:bg-ink peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent" />
      {label}
    </label>
  );
}
