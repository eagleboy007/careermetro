"use client";

import { Check } from "lucide-react";
import type { RideTask } from "@/lib/schemas/today";
import { useRide } from "./ride-state";

/** Today's tasks as big tick rows. The signal check row is ticked by answering the question, not here. */
export function TaskList({ tasks }: { tasks: readonly RideTask[] }) {
  const { done, setDone } = useRide();
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((task) => {
        const isDone = done.has(task.id);
        const locked = task.kind === "signal_check";
        return (
          <li key={task.id}>
            <label
              className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-line bg-bg px-3.5 py-[11px] transition-colors ${
                locked ? "cursor-default" : "cursor-pointer hover:border-accent"
              }`}
            >
              <input
                type="checkbox"
                className="peer sr-only"
                checked={isDone}
                disabled={locked}
                onChange={(e) => setDone(task.id, e.target.checked)}
              />
              <span className="grid size-6 place-items-center rounded-sm border-2 border-line bg-surface transition-all peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                <Check
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className={`text-on-accent transition-transform ${isDone ? "scale-100" : "scale-0"}`}
                />
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <b className={`text-[0.9rem] font-medium ${isDone ? "text-muted line-through decoration-line" : ""}`}>{task.title}</b>
                <small className="text-[0.76rem] text-muted">{task.source}</small>
              </span>
              <span className="whitespace-nowrap font-mono text-[0.72rem] text-muted">{task.minutes} min</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
