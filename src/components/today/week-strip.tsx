import { Check } from "lucide-react";
import type { WeekDay } from "@/lib/today/logic";

const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Monday to Sunday dots. Filled means a ride that day; today has a dashed ring until a task is ticked. */
export function WeekStrip({ days }: { days: readonly WeekDay[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[0.7rem] uppercase tracking-wider text-muted">This week</span>
      <ol className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => (
          <li
            key={d.date}
            className={`flex flex-col items-center gap-1 font-mono text-[0.64rem] ${d.isToday ? "font-semibold text-ink" : "text-muted"}`}
          >
            <span
              className={`grid size-[26px] place-items-center rounded-full ${
                d.rode ? "bg-accent" : d.isToday ? "border-2 border-dashed border-accent bg-surface" : "bg-surface-2"
              }`}
            >
              {d.rode && <Check size={13} strokeWidth={1.75} className="text-on-accent" aria-hidden="true" />}
            </span>
            <span aria-hidden="true">{d.letter}</span>
            <span className="sr-only">
              {DAY_NAME[i]}
              {d.isToday ? ", today" : ""}: {d.rode ? "rode" : d.isFuture ? "ahead" : "no ride"}
            </span>
          </li>
        ))}
      </ol>
      <span className="text-[0.78rem] text-muted">A ride is any one task. Miss a day and the count pauses; it never resets to zero.</span>
    </div>
  );
}
