"use client";

import type { Ride } from "@/lib/schemas/today";
import { rideProgress, type WeekDay } from "@/lib/today/logic";
import { MiniLine } from "./mini-line";
import { PitstopChip } from "./pitstop-chip";
import { useRide } from "./ride-state";
import { TaskList } from "./task-list";
import { WeekRing } from "./week-ring";
import { WeekStrip } from "./week-strip";

/**
 * Today's ride (handoff 5): the next 2 or 3 prep tasks for the current pitstop. Ticking them moves the train along
 * the dotted stretch and fills the weekly ring. Prep never fills a gap; only the prove pitstop does.
 */
export function RideCard({ ride, greeting, dayLabel, week }: { ride: Ride; greeting: string; dayLabel: string; week: readonly WeekDay[] }) {
  const { done } = useRide();
  const doneToday = ride.tasks.filter((t) => done.has(t.id)).length;
  const progress = rideProgress(ride, doneToday);
  const weekDone = Math.min(ride.weekTotal, ride.doneBeforeToday + doneToday);
  const minutes = ride.tasks.reduce((sum, t) => sum + t.minutes, 0);
  const { number, total, kind } = ride.pitstop;
  const ready = progress >= 1;
  const days = week.map((d) => (d.isToday ? { ...d, rode: d.rode || doneToday > 0 } : d));

  const sub =
    kind === "learn"
      ? `Two pitstops: learn it with this week's tasks (Pitstop ${number}), then prove it (Pitstop ${number + 1}) to fill the gap.`
      : `This is the prove pitstop. A skill check, a certificate or confirmed work fills the gap.`;
  const note = ready
    ? kind === "learn"
      ? `Pitstop ${number} done. Pitstop ${number + 1} is where you prove ${ride.goalName} and fill the gap.`
      : `You're ready. Prove ${ride.goalName} to fill the gap.`
    : doneToday === 0
      ? "Tasks get you ready. Proof fills the gap."
      : `${ride.weekTotal - weekDone} to go this week. Then prove it.`;

  return (
    <section
      aria-label="Today's ride"
      className="relative grid min-w-0 gap-7 overflow-hidden rounded-[24px] border border-line bg-surface px-5 pb-5 pt-6 sm:px-7 lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="flex min-w-0 flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <PitstopChip number={ready && kind === "learn" ? number + 1 : number} total={total} />
          <span className="font-mono text-[0.72rem] uppercase tracking-wider text-muted">
            {dayLabel} · today&apos;s ride, about {minutes} min
          </span>
        </div>
        <h2 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
          {greeting} This week is about <em className="not-italic text-accent">your {ride.goalName} goal.</em>
        </h2>
        <p className="max-w-[52ch] text-[0.95rem] text-muted">{sub}</p>
        <MiniLine stops={ride.lineStops} currentIndex={ride.currentStopIndex} progress={progress} />
        <TaskList tasks={ride.tasks} />
      </div>
      <div className="flex min-w-0 flex-col gap-[18px] border-line lg:border-l lg:pl-7">
        <WeekRing done={weekDone} total={ride.weekTotal} title={`${ride.goalName} prep this week`} note={note} />
        <WeekStrip days={days} />
      </div>
    </section>
  );
}
