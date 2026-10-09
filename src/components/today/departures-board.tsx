"use client";

import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import type { Departure } from "@/lib/schemas";
import { departureTone, departureWhen } from "@/lib/today/board";

const CHARS = "ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789";
const TONE = { now: "bg-board-good text-board", soon: "text-board-warn", later: "text-board-dim" } as const;

/**
 * Departures: roles the user is heading toward, ordered by gaps left, on a split-flap board (always dark).
 * `locked` covers it with a reason when there is no resume yet.
 */
export function DeparturesBoard({ rows, locked = false, allHref }: { rows: Departure[]; locked?: boolean; allHref?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const boardId = useId();
  return (
    <section
      aria-label="Departures: roles you are heading toward"
      className="shadow-raised relative flex min-w-0 flex-col gap-2.5 rounded-[20px] bg-board px-[18px] pb-3.5 pt-[18px] text-board-ink"
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="font-mono! text-[0.82rem] font-medium uppercase tracking-[0.14em]!">Departures</h3>
        <span className="text-[0.76rem] text-board-dim">roles you&apos;re heading toward</span>
        {!locked &&
          (allHref ? (
            <Link href={allHref} className="ml-3 inline-flex items-center gap-1 text-[0.76rem] focus-visible:outline-board-ink">
              All departures
              <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          ) : (
            <span className="ml-3 text-[0.76rem] text-board-dim">All departures · soon</span>
          ))}
        <Clock />
      </div>
      <ul className={locked ? "opacity-30" : undefined} aria-hidden={locked || undefined}>
        {rows.map((r, i) => {
          const isOpen = open === r.id;
          return (
            <li key={r.id} className="border-t border-board-line">
              <button
                type="button"
                disabled={locked}
                aria-expanded={isOpen}
                aria-controls={`${boardId}-${r.id}`}
                onClick={() => setOpen(isOpen ? null : r.id)}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] focus-visible:outline-board-ink items-center gap-2.5 px-0.5 py-2.5 text-left font-mono text-[0.76rem] uppercase tracking-[0.04em] sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]"
              >
                <Flap text={r.role} delay={i * 120} className="truncate font-medium" />
                <span className="hidden truncate text-board-dim sm:block">{r.where}</span>
                <span className={`whitespace-nowrap rounded-[4px] px-[7px] py-0.5 text-right font-medium ${TONE[departureTone(r.gapsLeft)]}`}>
                  <Flap text={departureWhen(r.gapsLeft)} delay={i * 120 + 200} />
                </span>
              </button>
              {isOpen && (
                <div id={`${boardId}-${r.id}`} className="flex flex-wrap items-center gap-1.5 pb-2.5 text-[0.8rem] text-board-dim">
                  {r.gaps.map((g) => (
                    <StatusChip key={g.name} status={g.status} label={g.name} />
                  ))}
                  <span>{r.note}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {locked && (
        <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 items-center justify-center gap-2.5 rounded-md bg-surface px-3.5 py-3 text-center text-[0.85rem] font-medium text-ink">
          <Lock size={16} strokeWidth={1.75} className="shrink-0 text-muted" aria-hidden="true" />
          Add your resume to see which of these you could board.
        </div>
      )}
      <p className="border-t border-board-line pt-1.5 text-[0.72rem] text-board-dim">
        From public job-board feeds and job posts you paste. Tap a row to see what stands between you and it.
      </p>
    </section>
  );
}

/** The board's clock, India time. Drawn after load so the server and browser never disagree. */
function Clock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const format = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    const tick = () => setNow(format.format(new Date()));
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="ml-auto font-mono text-[0.78rem] tabular-nums" aria-hidden="true">
      {now ?? "--:--"}
    </span>
  );
}

/** Letters flip through random characters before they settle. Off with reduced motion; screen readers get the word. */
function Flap({ text, delay, className }: { text: string; delay: number; className?: string }) {
  const target = text.toUpperCase();
  const [shown, setShown] = useState(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const chars = [...target];
    const current = [...target];
    const random = () => CHARS[Math.floor(Math.random() * CHARS.length)];
    const timers: ReturnType<typeof setTimeout>[] = [];
    chars.forEach((c, i) => {
      if (c === " ") return;
      let n = 0;
      const max = 4 + (i % 6);
      const tick = () => {
        current[i] = n++ < max ? random() : c;
        setShown(current.join(""));
        if (n <= max) timers.push(setTimeout(tick, 45));
      };
      timers.push(setTimeout(tick, delay + i * 18));
    });
    return () => {
      timers.forEach(clearTimeout);
      setShown(target);
    };
  }, [target, delay]);
  return (
    <span className={className}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
