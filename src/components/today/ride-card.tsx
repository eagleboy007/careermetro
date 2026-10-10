"use client";

import { Award, BriefcaseBusiness, Check, CircleHelp, Route, TrainFront, Video } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ProvePitstop, Ride, RideWeek } from "@/lib/schemas";
import { TaskList } from "./task-list";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const RING = 2 * Math.PI * 42;

/**
 * Today's ride: the next 2 or 3 prep tasks for the current pitstop. Ticking tasks moves the train toward the pitstop
 * and fills the weekly ring. `onToggle` saves a tick; without it the card only keeps local state (design page).
 */
export function RideCard({
  name,
  greeting = "Hi",
  ride,
  week,
  onToggle,
  signalAnswered = false,
}: {
  name: string;
  /** "Morning", "Afternoon" or "Evening" in the user's time zone, picked on the server. */
  greeting?: string;
  ride: Ride;
  week: RideWeek;
  onToggle?: (taskId: string, done: boolean) => void;
  /** The signal check was answered today: that ticks the ride's locked task. */
  signalAnswered?: boolean;
}) {
  const [ticked, setTicked] = useState(() => new Set(ride.tasks.filter((t) => t.done && !t.locked).map((t) => t.id)));
  const done = new Set([...ticked, ...ride.tasks.filter((t) => t.locked && (t.done || signalAnswered)).map((t) => t.id)]);
  const added = ride.tasks.filter((t) => done.has(t.id) && !t.done).length;
  const removed = ride.tasks.filter((t) => !done.has(t.id) && t.done).length;
  const weekDone = Math.max(0, Math.min(ride.weekTasksTotal, ride.weekTasksDone + added - removed));
  const share = weekDone / ride.weekTasksTotal;
  const rodeToday = done.size > 0;
  const todayIndex = week.findIndex((d) => d.today);
  const today = DAYS[todayIndex] ?? null;
  const lead = ride.title.slice(0, ride.title.length - ride.titleEmphasis.length);

  function toggle(id: string) {
    const next = new Set(ticked);
    const on = !next.has(id);
    if (on) next.add(id);
    else next.delete(id);
    setTicked(next);
    onToggle?.(id, on);
  }

  return (
    <section
      aria-label="Today's ride"
      className="grid gap-[18px] rounded-[20px] border border-line bg-surface px-4 pb-[18px] pt-5 md:grid-cols-[minmax(0,1fr)_300px] md:gap-7 md:rounded-[24px] md:px-7 md:pb-[22px] md:pt-[26px]"
    >
      <div className="flex min-w-0 flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-2.5">
          <PitstopChip pitstop={ride.pitstop} count={ride.pitstopCount} />
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
            {today ? `${today} · ` : ""}Today&apos;s ride, about {ride.tasks.reduce((n, t) => n + t.minutes, 0)} min
          </span>
        </div>
        <h2 className="max-w-[28ch] text-balance text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold leading-[1.05] tracking-[-0.03em]">
          {greeting}, {name}. {lead}
          {ride.titleEmphasis && <em className="not-italic text-accent">{ride.titleEmphasis}</em>}
        </h2>
        <p className="max-w-[52ch] text-[0.95rem] text-muted">{ride.summary}</p>
        <MiniLine pitstop={ride.pitstop} count={ride.pitstopCount} share={share} />
        <TaskList tasks={ride.tasks} done={done} onToggle={toggle} />
        {ride.prove && <ProveBox prove={ride.prove} goalName={ride.goalName} />}
      </div>

      <div className="flex min-w-0 flex-col gap-[18px] border-t border-line pt-4 md:border-l md:border-t-0 md:pl-7 md:pt-0">
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

/** The whole line: every pitstop, then the Practice and Match stops, with the train on the stretch to the current pitstop. */
function MiniLine({ pitstop, count, share }: { pitstop: number; count: number; share: number }) {
  const stops: { key: string; label: string; n: number | null }[] = [
    ...Array.from({ length: count }, (_, i) => ({ key: `p${i + 1}`, label: String(i + 1), n: i + 1 })),
    { key: "practice", label: "Practice", n: null },
    { key: "match", label: "Match", n: null },
  ];
  const last = stops.length - 1;
  const x = (i: number) => 3.33 + (i / last) * 93.33;
  const from = x(Math.max(0, pitstop - 2));
  const to = x(pitstop - 1);
  const train = from + (to - from) * share * 0.94;
  return (
    <div className="relative mt-1 h-[74px]" aria-hidden="true">
      <span className="absolute top-[38px] h-1.5 rounded-full bg-line" style={{ left: `${x(0)}%`, right: `${100 - x(last)}%` }} />
      <span className="absolute top-[38px] h-1.5 rounded-full bg-accent" style={{ left: `${x(0)}%`, width: `${Math.max(0, from - x(0))}%` }} />
      <span
        className="absolute top-[38px] h-1.5 rounded-full bg-accent transition-[width] duration-700"
        style={{ left: `${from}%`, width: `${Math.max(0, train - from)}%` }}
      />
      {stops.map((s, i) => {
        const done = s.n !== null && s.n < pitstop;
        const big = s.n === null;
        return (
          <span key={s.key}>
            <span
              className={`absolute -translate-x-1/2 border-[3px] ${big ? "top-[32px] size-[18px] rounded-[6px]" : "top-[33px] size-4 rounded-full"} ${
                done ? "border-accent bg-accent" : "border-line bg-surface"
              }`}
              style={{ left: `${x(i)}%` }}
            />
            <span
              className={`absolute top-[56px] -translate-x-1/2 font-mono text-[10.5px] uppercase tracking-[0.04em] ${
                s.n === pitstop ? "font-semibold text-ink" : "hidden text-muted min-[1100px]:inline"
              }`}
              style={{ left: `${x(i)}%` }}
            >
              {s.label}
            </span>
          </span>
        );
      })}
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

/** "Pitstop N of M", with a short note on goals and pitstops one tap away. */
function PitstopChip({ pitstop, count }: { pitstop: number; count: number }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span
      ref={wrap}
      className="relative"
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-[11px] py-1.5 text-[0.8rem] font-semibold"
      >
        <Route size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Pitstop {pitstop} of {count}
        <CircleHelp size={14} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
        <span className="sr-only">, what is a pitstop?</span>
      </button>
      <div
        id={popId}
        hidden={!open}
        className="shadow-raised absolute left-0 top-[calc(100%+8px)] z-30 flex w-[min(280px,calc(100vw-32px))] flex-col gap-1.5 rounded-[16px] border border-line bg-surface px-4 py-3.5 text-[0.84rem] leading-[1.45]"
      >
        <b className="font-display text-[0.98rem] font-semibold">Goals and pitstops</b>
        <p>
          Each goal is one gap between you and your destination. The app suggests the pitstops for each goal, usually two: <b>learn</b> (a
          free course, with daily tasks like videos, reading and practice) and <b>prove</b>.
        </p>
        <p>
          Only the prove pitstop fills the gap: a skill check, a certification, or work experience backed by a course or certificate. Then
          the goal is met and your train moves to the next one.
        </p>
        <p className="text-muted">Your destination is your next role, not your last. Reach it and you pick the next one.</p>
      </div>
    </span>
  );
}

const PROVE_ICON = { check: Video, cert: Award, work: BriefcaseBusiness } as const;

/** The prove pitstop that follows this week's learn pitstop. Any one option fills the gap. */
function ProveBox({ prove, goalName }: { prove: ProvePitstop; goalName: string }) {
  const [asked, setAsked] = useState(false);
  return (
    <section
      className="mt-1 flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface px-4 py-3.5"
      aria-label={`Pitstop ${prove.pitstop}, prove ${goalName}`}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <b className="font-display text-[1.02rem] font-semibold">
          Pitstop {prove.pitstop} · Prove {goalName}
        </b>
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
          {prove.options.length === 1 ? "one way" : prove.options.length === 2 ? "any one of two" : "any one of three"}
        </span>
      </div>
      <p className="text-[0.84rem] text-muted">{prove.why}</p>
      <ul className="flex flex-col gap-2">
        {prove.options.map((o) => {
          const Icon = PROVE_ICON[o.kind];
          return (
            <li key={o.kind} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[14px] bg-surface-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="flex flex-col gap-0.5 text-[0.9rem]">
                <b className="font-semibold">{o.title}</b>
                <small className="text-[0.8rem] leading-[1.4] text-muted">{o.detail}</small>
              </span>
              <button
                type="button"
                onClick={() => setAsked(true)}
                className="col-start-2 justify-self-start whitespace-nowrap rounded-full border border-line bg-surface px-[11px] py-1.5 text-[0.8rem] font-semibold sm:col-start-3"
              >
                {o.action}
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className={`text-[0.8rem] text-muted ${asked ? "" : "sr-only"}`}>
        {asked ? "Proof opens in a later build. Your tasks above already count toward this goal." : ""}
      </p>
    </section>
  );
}
