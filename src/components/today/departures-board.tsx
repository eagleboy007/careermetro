"use client";

import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Departure } from "@/lib/schemas/today";
import { departureWhen, orderDepartures, type DepartureTone } from "@/lib/today/logic";
import { LampChip } from "./lamp-chip";

const CHARS = "ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789";
const TONE: Record<DepartureTone, string> = {
  now: "bg-good text-board",
  soon: "text-warn",
  later: "text-board-dim",
};

/**
 * Departures (handoff 5): a split-flap board of roles from public job-board feeds and pasted posts, ordered by gaps
 * left. Always dark in both themes. `locked` blurs the rows for the No resume state.
 */
export function DeparturesBoard({ rows, clock, locked = false }: { rows: readonly Departure[]; clock: string; locked?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section
      aria-label="Departures: roles you are heading toward"
      className="shadow-raised relative flex min-w-0 flex-col gap-2.5 rounded-lg bg-board px-[18px] pb-3.5 pt-[18px] text-board-ink"
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="font-mono text-[0.82rem] font-medium uppercase tracking-[0.14em]">Departures</h3>
        <span className="text-[0.76rem] text-board-dim">roles you&apos;re heading toward</span>
        {!locked && (
          <Link href="/departures" className="inline-flex items-center gap-1 text-[0.76rem] text-board-dim hover:text-board-ink">
            All departures
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
        <span className="ml-auto font-mono text-[0.78rem]">{clock}</span>
      </div>
      <ul className={`flex flex-col ${locked ? "pointer-events-none opacity-45 blur-[3px]" : ""}`} aria-hidden={locked || undefined}>
        {orderDepartures(rows).map((row, i) => {
          const when = departureWhen(row.gaps.length);
          const isOpen = open === row.id;
          return (
            <li key={row.id} className="border-t border-board-line">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : row.id)}
                aria-expanded={isOpen}
                tabIndex={locked ? -1 : undefined}
                className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] items-center gap-2.5 px-0.5 py-2.5 text-left font-mono text-[0.76rem] uppercase tracking-[0.04em] hover:bg-board-line/40"
              >
                <Flap text={row.role} delay={i * 120} className="truncate font-medium" />
                <span className="truncate text-board-dim">
                  {row.city} · {row.posts} posts
                </span>
                <span className="whitespace-nowrap text-right">
                  <Flap text={when.label} delay={i * 120 + 200} className={`rounded-[4px] px-[7px] py-0.5 font-medium ${TONE[when.tone]}`} />
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-wrap items-center gap-1.5 pb-2.5 text-[0.8rem] text-board-dim">
                  {row.gaps.map((g) => (
                    <LampChip key={g.skillName} status={g.status} label={g.skillName} />
                  ))}
                  <span>
                    {row.gaps.length === 0
                      ? "No required gaps. Your resume already fits these. Apply while you ride."
                      : `${row.gaps.length} ${row.gaps.length === 1 ? "gap" : "gaps"} between you and these, each with the pitstop that closes it.`}
                    {row.isDestination ? " Your destination." : ""}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {locked && (
        <div className="absolute inset-x-[18px] top-1/2 flex -translate-y-1/2 items-center justify-center gap-2 rounded-md bg-board/90 px-4 py-3 text-[0.84rem]">
          <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
          Add your resume to see which of these you could board.
        </div>
      )}
      <p className="border-t border-board-line pt-1.5 text-[0.72rem] text-board-dim">
        From public job-board feeds and job posts you paste. Tap a row to see what stands between you and it.
      </p>
    </section>
  );
}

/** Letters flip through random characters before settling. Off with reduced motion; screen readers get the plain text. */
function Flap({ text, delay, className }: { text: string; delay: number; className?: string }) {
  const target = text.toUpperCase();
  const [shown, setShown] = useState(target);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let tick = 0;
    const settle = target.length + 6;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      tick++;
      setShown(
        [...target]
          .map((ch, i) => (ch === " " || tick > 4 + i ? ch : CHARS[Math.floor(Math.random() * CHARS.length)]))
          .join(""),
      );
      if (tick < settle) timer = setTimeout(step, 45);
    };
    timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [target, delay]);

  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
