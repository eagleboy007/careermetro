"use client";

import { Check } from "lucide-react";
import type { RideTask } from "@/lib/schemas";

/** Today's prep tasks as checkboxes. Ticking one moves the train; prep never fills a gap on its own. */
export function TaskList({ tasks, done, onToggle }: { tasks: RideTask[]; done: ReadonlySet<string>; onToggle: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => {
        const checked = done.has(t.id);
        return (
          <li key={t.id}>
            <label
              className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-line bg-bg px-3.5 py-2.5 transition-colors ${
                t.locked ? "cursor-default" : "cursor-pointer hover:border-accent"
              }`}
            >
              <input type="checkbox" className="peer sr-only" checked={checked} disabled={t.locked} onChange={() => onToggle(t.id)} />
              <span
                aria-hidden="true"
                className="grid size-6 place-items-center rounded-sm border-2 border-line bg-surface transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                {checked && <Check size={14} strokeWidth={3} className="text-on-accent" />}
              </span>
              <span className="flex min-w-0 flex-col">
                <b className={`text-[0.9rem] font-medium ${checked ? "text-muted line-through decoration-line" : ""}`}>{t.title}</b>
                <small className="text-[0.76rem] text-muted">
                  {t.detail}
                  {t.locked ? " · opens after your other tasks" : ""}
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
