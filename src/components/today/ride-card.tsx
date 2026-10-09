"use client";

import { Check, Route, TrainFront } from "lucide-react";
import { useState } from "react";
import type { Ride, RideWeek } from "@/lib/schemas";
import { TaskList } from "./task-list";

const RING = 2 * Math.PI * 42;

/**
 * Today's ride: the next 2 or 3 prep tasks for the current pitstop. Ticking tasks moves the train toward the pitstop
 * and fills the weekly ring. `onToggle` saves a tick; without it the card only keeps local state (design page).
 */
export function RideCard({
  name,
  ride,
  week,
  onToggle,
  signalAnswered = false,
}: {
  name: string;
  ride: Ride;
  week: RideWeek;
  onToggle?: (taskId: string, done: boolean) => void;
  /** The signal check was answered today: that ticks the ride's locked task. */
  signalAnswered?: boolean;
}) {
  const [ticked, setDone] = useState(() => new Set(ride.tasks.filter((t) => t.done && !t.locked).map((t) => t.id)));
  const done = new Set([...ticked, ...ride.tasks.filter((t) => t.locked && (t.done || signalAnswered)).map((t) => t.id)]);
  const added = ride.tasks.filter((t) => done.has(t.id) && !t.done).length;
  const removed = ride.tasks.filter((t) => !done.has(t.id) && t.done).length;
  const weekDone = Math.max(0, Math.min(ride.weekTasksTotal, ride.weekTasksDone + added - removed));
  const share = weekDone / ride.weekTasksTotal;
  const rodeToday = done.size > 0;

  function toggle(id: string) {
    const next = new Set(ticked);
    const on = !next.has(id);
    if (on) next.add(id);
    else next.delete(id);
    setDone(next);
    onToggle?.(id, on);
  }
  const tasks = ride.tasks;

  return (
    <section aria-label="Today's ride" className="grid gap-7 overflow-hidden rounded-[24px] border border-line bg-surface px-4 py-5 md:grid-cols-[minmax(0,1fr)_300px] md:px-7 md:py-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-semibold">
            <Route size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
            Pitstop {ride.pitstop} of {ride.pitstopCount}
          </span>
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
            Today&apos;s ride, about {ride.tasks.reduce((n, t) => n + t.minutes, 0)} min
          </span>
        </div>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05]">
          Hi {name}. {ride.title}
        </h2>
        <p className="max-w-[52ch] text-[0.95rem] text-muted">{ride.summary}</p>
        <MiniLine pitstop={ride.pitstop} count={ride.pitstopCount} share={share} />
        <TaskList tasks={tasks} done={done} onToggle={toggle} />
      </div>

      <div className="flex min-w-0 flex-col gap-4 border-t border-line pt-4 md:border-l md:border-t-0 md:pl-7 md:pt-0">
        <div className="flex items-center gap-4">
          <div className="relative size-24 shrink-0">
            <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="stroke-surface-2" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                strokeWidth="9"
                strokeLinecap="round"
                opacity={share === 0 ? 0 : 1}
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - share)}
                className="stroke-accent transition-[stroke-dashoffset] duration-700"
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <b className="font-display text-2xl font-semibold leading-none tabular-nums">
                  {weekDone}/{ride.weekTasksTotal}
                </b>
                <small className="mt-1 block font-mono text-[0.6rem] uppercase tracking-[0.06em] text-muted">tasks</small>
              </div>
            </div>
          </div>
          <p className="text-[0.86rem] text-muted">
            <b className="mb-0.5 block text-[0.95rem] font-semibold text-ink">{ride.goalName} prep this week</b>
            Tasks get you ready. Proof fills the gap.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">This week</span>
          <ol className="grid grid-cols-7 gap-1.5" aria-label="Days ridden this week">
            {week.map((d, i) => {
              const on = d.rode || (d.today && rodeToday);
              return (
                <li key={i} className={`flex flex-col items-center gap-1 font-mono text-[0.64rem] ${d.today ? "font-semibold text-ink" : "text-muted"}`}>
                  <span
                    className={`grid size-[26px] place-items-center rounded-full ${
                      on ? "bg-accent" : d.today ? "border-2 border-dashed border-accent bg-surface" : "bg-surface-2"
                    }`}
                  >
                    {on && <Check size={13} strokeWidth={1.75} className="text-on-accent" aria-hidden="true" />}
                  </span>
                  <span>
                    {d.label}
                    <span className="sr-only">{on ? ", rode" : d.today ? ", today" : ""}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <span className="text-[0.78rem] text-muted">A ride is any one task. Miss a day and the count pauses; it never resets to zero.</span>
        </div>
      </div>
    </section>
  );
}

/** The stretch of line around the current pitstop, with the train on the dotted prep part. */
function MiniLine({ pitstop, count, share }: { pitstop: number; count: number; share: number }) {
  const stops = Array.from({ length: count }, (_, i) => i + 1);
  const x = (n: number) => (count === 1 ? 50 : 4 + ((n - 1) / (count - 1)) * 92);
  const from = x(Math.max(1, pitstop - 1));
  const to = x(pitstop);
  const train = from + (to - from) * share * 0.94;
  return (
    <div className="relative mt-1 h-[74px]" aria-hidden="true">
      <span className="absolute top-[38px] h-1.5 rounded-full bg-line" style={{ left: `${x(1)}%`, right: `${100 - x(count)}%` }} />
      <span className="absolute top-[38px] h-1.5 rounded-full bg-accent" style={{ left: `${x(1)}%`, width: `${Math.max(0, from - x(1))}%` }} />
      <span
        className="absolute top-[38px] h-1.5 rounded-full bg-accent transition-[width] duration-700"
        style={{ left: `${from}%`, width: `${Math.max(0, train - from)}%` }}
      />
      {stops.map((n) => (
        <span key={n}>
          <span
            className={`absolute top-[33px] size-4 -translate-x-1/2 rounded-full border-[3px] ${n < pitstop ? "border-accent bg-accent" : "border-line bg-surface"}`}
            style={{ left: `${x(n)}%` }}
          />
          <span
            className={`absolute top-[56px] -translate-x-1/2 font-mono text-[10.5px] uppercase ${n === pitstop ? "font-semibold text-ink" : "text-muted"}`}
            style={{ left: `${x(n)}%` }}
          >
            {n}
          </span>
        </span>
      ))}
      <span
        className="absolute top-1 flex -translate-x-1/2 flex-col items-center gap-[3px] transition-[left] duration-1000"
        style={{ left: `${train}%` }}
      >
        <span className="shadow-raised inline-flex items-center gap-1 rounded-full bg-accent py-[3px] pl-[7px] pr-[9px] text-[0.72rem] font-semibold text-on-accent">
          <TrainFront size={14} strokeWidth={1.75} />
          You
        </span>
        <span className="h-[9px] w-0.5 bg-accent" />
      </span>
    </div>
  );
}
