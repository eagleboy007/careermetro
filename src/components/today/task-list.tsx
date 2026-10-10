"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import type { RideTask } from "@/lib/schemas";

/** Today's prep tasks as checkboxes. Ticking one moves the train; prep never fills a gap on its own. */
export function TaskList({ tasks, done, onToggle }: { tasks: RideTask[]; done: ReadonlySet<string>; onToggle: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => {
        const checked = done.has(t.id);
        if (t.href && !checked) {
          // Done on another page, such as building the path: a link, not a box to tick.
          return (
            <li key={t.id}>
              <Link
                href={t.href}
                className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-line bg-bg px-3.5 py-2.5 transition-colors hover:border-ink"
              >
                <span aria-hidden="true" className="grid size-6 place-items-center rounded-sm bg-accent-soft text-accent">
                  <ArrowRight size={14} strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <b className="text-[0.9rem] font-medium">{t.title}</b>
                  <small className="text-[0.76rem] text-muted">{t.detail}</small>
                </span>
                <span className="whitespace-nowrap font-mono text-[0.72rem] text-muted">{t.minutes} min</span>
              </Link>
            </li>
          );
        }
        return (
          <li key={t.id}>
            <label
              className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-line bg-bg px-3.5 py-2.5 transition-colors ${
                t.locked ? "cursor-default" : "cursor-pointer hover:border-ink"
              }`}
            >
              <input type="checkbox" className="peer sr-only" checked={checked} disabled={t.locked} onChange={() => onToggle(t.id)} />
              <span
                aria-hidden="true"
                className="grid size-6 place-items-center rounded-sm border-2 border-line bg-surface transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                {checked && <Check size={14} strokeWidth={1.75} className="text-on-accent" />}
              </span>
              <span className="flex min-w-0 flex-col">
                <b className={`text-[0.9rem] font-medium ${checked ? "text-muted line-through decoration-line" : ""}`}>{t.title}</b>
                <small className="text-[0.76rem] text-muted">
                  {t.detail}
                  {t.signal && !checked ? " · ticks itself when you answer it" : ""}
                </small>
              </span>
              <span className="whitespace-nowrap font-mono text-[0.72rem] text-muted">{t.minutes} min</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
