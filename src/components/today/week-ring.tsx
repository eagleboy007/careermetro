const C = 2 * Math.PI * 42;

/** The weekly ring: this week's prep tasks for the current pitstop. Progress, so cobalt. */
export function WeekRing({ done, total, title, note }: { done: number; total: number; title: string; note: string }) {
  const share = Math.min(1, done / total);
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-24 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r="42" fill="none" className="stroke-surface-2" strokeWidth={9} />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            className="stroke-accent transition-[stroke-dashoffset] duration-700"
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={C.toFixed(1)}
            strokeDashoffset={(C * (1 - share)).toFixed(1)}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <b className="block font-display text-2xl font-semibold leading-none tabular-nums">
              {done}/{total}
            </b>
            <small className="mt-1 block font-mono text-[0.6rem] uppercase tracking-wider text-muted">tasks</small>
          </div>
        </div>
      </div>
      <p className="text-[0.86rem] text-muted" aria-live="polite">
        <b className="mb-0.5 block text-[0.95rem] font-semibold text-ink">{title}</b>
        {note}
      </p>
    </div>
  );
}
