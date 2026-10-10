"use client";

import { Check, Route } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { DEFAULT_WEEKLY_HOURS, WEEKLY_HOURS, type FirstTally, type RideTask } from "@/lib/schemas";
import { TaskList } from "./task-list";

export type { FirstTally };

/**
 * First sign-up: the resume was just read. Shows what was found, the first ride and three setup taps. `onHours` and
 * `onFindable` save the choices; without them the hero keeps local state (design page).
 */
export function WelcomeHero({
  name,
  role,
  tally,
  firstTasks,
  lineHours,
  weeklyHours = DEFAULT_WEEKLY_HOURS,
  onHours,
  onFindable,
  onToggle,
}: {
  name: string;
  role: string;
  tally: FirstTally;
  firstTasks: RideTask[];
  /** Estimated hours for the whole line, for the weeks estimate. */
  lineHours: number;
  /** The hours a week the person picked before. */
  weeklyHours?: number;
  /** Saves the hours a week. Without it the choice is only kept on screen (design page). */
  onHours?: (hours: number) => void | Promise<boolean>;
  onFindable?: (on: boolean) => void;
  /** Saves a tick. Without it the card only keeps local state (design page). */
  onToggle?: (taskId: string, done: boolean) => void | Promise<boolean>;
}) {
  const [done, setDone] = useState(() => new Set(firstTasks.filter((t) => t.done).map((t) => t.id)));
  const [hours, setHours] = useState<number>(weeklyHours);
  const [findable, setFindable] = useState(false);
  const weeks = Math.max(1, Math.ceil(lineHours / hours));

  function toggle(id: string) {
    const next = new Set(done);
    const on = !next.has(id);
    if (on) next.add(id);
    else next.delete(id);
    setDone(next);
    // A refused or failed save puts the box back, so the card never shows a tick that wasn't kept.
    const undo = () =>
      setDone((now) => {
        const back = new Set(now);
        if (on) back.delete(id);
        else back.add(id);
        return back;
      });
    Promise.resolve(onToggle?.(id, on)).then((saved) => saved === false && undo(), undo);
  }

  return (
    <section
      aria-label="Welcome"
      className="grid gap-7 overflow-hidden rounded-[24px] border border-line bg-surface px-4 py-5 md:grid-cols-[minmax(0,1fr)_300px] md:px-7 md:py-6"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-semibold">
            <Route size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
            Day 1
          </span>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Signed up just now · resume read</span>
        </div>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05]">
          Welcome aboard, {name}. <em className="not-italic text-accent">Your line is drawn.</em>
        </h2>
        <p className="max-w-[54ch] text-[0.95rem] text-muted">
          We read your resume against {role}. Here is where you stand, and your first ride is ready.
        </p>
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tally value={tally.skillsFound} label="skills you already have" dot="bg-good" />
          <Tally value={tally.gaps} label="gaps to close" dot="bg-bad" />
          <Tally value={tally.goals} label="goals on your line" dot="bg-accent" />
          <Tally value={tally.boardable} label={tally.boardable === 1 ? "role you could board today" : "roles you could board today"} dot="bg-line" />
        </dl>
        <h3 className="text-base font-semibold">Your first ride · Pitstop 1, about {firstTasks.reduce((n, t) => n + t.minutes, 0)} min</h3>
        <TaskList tasks={firstTasks} done={done} onToggle={toggle} />
      </div>

      <div className="flex min-w-0 flex-col gap-3.5 border-t border-line pt-4 md:border-l md:border-t-0 md:pl-7 md:pt-0">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Set up in three taps</span>
        <ol className="flex flex-col gap-4">
          <Setup n={1} done title="Resume read">
            <small className="text-[0.76rem] text-muted">
              {tally.skillsFound} skills found, {tally.gaps} gaps, all with evidence
            </small>
          </Setup>
          <Setup n={2} title="Hours a week for learning">
            <div role="group" aria-label="Hours a week" className="flex flex-wrap gap-1">
              {WEEKLY_HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={h === hours}
                  onClick={() => {
                    setHours(h);
                    onHours?.(h);
                  }}
                  className="rounded-full border border-line px-3 py-1 text-[0.78rem] font-medium text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink"
                >
                  {h} h
                </button>
              ))}
            </div>
            <small className="text-[0.76rem] text-muted" aria-live="polite">
              At {hours} hours a week your line takes about {weeks} {weeks === 1 ? "week" : "weeks"}.
            </small>
          </Setup>
          <Setup n={3} title="Let people on your line find you">
            <label className="flex items-center gap-2 text-[0.84rem]">
              <input
                type="checkbox"
                checked={findable}
                onChange={(e) => {
                  setFindable(e.target.checked);
                  onFindable?.(e.target.checked);
                }}
                className="size-4 accent-ink"
              />
              Show me in people lists
            </label>
            <small className="text-[0.76rem] text-muted">Off by default. Name and status only; never your resume.</small>
          </Setup>
        </ol>
      </div>
    </section>
  );
}

function Tally({ value, label, dot }: { value: number; label: string; dot: string }) {
  const shown = useCountUp(value);
  return (
    <div className="relative flex flex-col gap-1 rounded-md border border-line bg-bg px-3.5 pb-3 pt-6">
      <dt className="order-2 text-[0.78rem] leading-snug text-muted">
        <span className={`absolute left-3.5 top-3 block size-2 rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="order-1 font-display text-[2rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">
        <span aria-hidden="true">{shown}</span>
        <span className="sr-only">{value}</span>
      </dd>
    </div>
  );
}

/** Counts up to the value once, unless the user prefers reduced motion. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  // Layout effect: reset to 0 before the first paint, so the number doesn't flash its final value first.
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) return;
    let frame = 0;
    const start = performance.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- must reset before paint; a later frame would flash the value
    setShown(0);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

function Setup({ n, done = false, title, children }: { n: number; done?: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-3">
      <span
        className={`grid size-7 place-items-center rounded-full border-2 font-mono text-[0.75rem] ${
          done ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-muted"
        }`}
      >
        {done ? (
          <>
            <Check size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">done</span>
          </>
        ) : (
          n
        )}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <b className={`text-[0.9rem] font-semibold ${done ? "text-muted" : ""}`}>{title}</b>
        {children}
      </div>
    </li>
  );
}
