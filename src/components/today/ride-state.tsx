"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { RideTask } from "@/lib/schemas/today";

type RideState = {
  /** Ids of today's tasks that are ticked. */
  done: ReadonlySet<string>;
  setDone: (taskId: string, done: boolean) => void;
  /** Answering the signal check ticks the day's signal check task. */
  answerSignalCheck: () => void;
};

const RideContext = createContext<RideState | null>(null);

/**
 * Today's ticked tasks, shared by the ride card, the signal check and the streak chip.
 * Local only for now: saving ticks to `ride_days` comes with "Today live" (handoff PR 6).
 */
export function RideProvider({ tasks, children }: { tasks: readonly RideTask[]; children: ReactNode }) {
  const [done, setDoneIds] = useState<ReadonlySet<string>>(() => new Set(tasks.filter((t) => t.done).map((t) => t.id)));
  const value = useMemo<RideState>(
    () => ({
      done,
      setDone: (taskId, isDone) =>
        setDoneIds((prev) => {
          const next = new Set(prev);
          if (isDone) next.add(taskId);
          else next.delete(taskId);
          return next;
        }),
      answerSignalCheck: () => {
        const signal = tasks.find((t) => t.kind === "signal_check");
        if (signal) setDoneIds((prev) => new Set(prev).add(signal.id));
      },
    }),
    [done, tasks],
  );
  return <RideContext value={value}>{children}</RideContext>;
}

const EMPTY: RideState = { done: new Set(), setDone: () => {}, answerSignalCheck: () => {} };

/** Today's ride state. Outside a provider nothing is ticked, which suits the No resume state. */
export function useRide(): RideState {
  return useContext(RideContext) ?? EMPTY;
}
