import { CircleAlert, FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import { floorText } from "@/lib/market/live";
import { isExampleSource, monthLabel, type Sourced } from "@/lib/market/query";

/* Small pieces shared by the Market cards (handoff C6). */

export const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
export const label = "font-mono text-[0.68rem] uppercase tracking-[0.06em] text-muted";

/**
 * The "Example data" badge in the Market's header when its figures are made up, and on /design over the live sections,
 * whose counts are synthetic (T120). Neutral chip style: it says nothing about gaps or progress.
 */
export function ExampleDataBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 font-mono text-[0.72rem] font-medium uppercase tracking-[0.06em] text-ink">
      <FlaskConical size={14} {...ICON} />
      Example data
    </span>
  );
}

/** A Market card: a heading, a note on the right, the body, and the source line at the foot. */
export function Card({ id, title, note, source, className = "", children }: { id: string; title: string; note?: ReactNode; source: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface p-[18px] min-[760px]:p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={id} className="text-[1.12rem] font-semibold leading-tight tracking-[-0.015em]">
          {title}
        </h2>
        {note && <div className="ml-auto">{note}</div>}
      </div>
      {children}
      <div className="mt-auto border-t border-dashed border-line pt-2.5">{source}</div>
    </section>
  );
}

/** Where a card's figures come from, and the month. Example rows say so in capitals. */
export function SourceLine({ of, shape }: { of: Sourced; shape: string }) {
  const example = isExampleSource(of);
  return (
    <p className="font-mono text-[0.66rem] leading-relaxed tracking-[0.04em] text-muted">
      {example ? (
        <>
          <b className="font-medium text-ink">EXAMPLE DATA</b> · Made up to show the design, {shape} · {monthLabel(of.month)}
        </>
      ) : (
        <>
          Source: {of.sources.join(", ")} · {monthLabel(of.month)}
        </>
      )}
    </p>
  );
}

/** A live card's source line (src/lib/market/live.ts, liveSourceLine): the boards and the day, never EXAMPLE DATA. */
export function LiveSourceLine({ text }: { text: string }) {
  return <p className="font-mono text-[0.66rem] leading-relaxed tracking-[0.04em] text-muted">{text}</p>;
}

/** Shown instead of any figure with fewer than 15 openings behind it (a month's on example data, open now on live). */
export function NotEnough({ children, small = false, live = false }: { children?: ReactNode; small?: boolean; live?: boolean }) {
  if (small) return <span className="text-[0.8rem] text-muted">Not enough data</span>;
  return (
    <p className="flex items-start gap-2 text-[0.84rem] text-muted">
      <CircleAlert size={16} {...ICON} className="mt-0.5 shrink-0" />
      <span>
        <b className="font-semibold text-ink">Not enough data.</b> {children ?? floorText(live)}
      </span>
    </p>
  );
}

/** A big number with its label underneath. */
export function Stat({ value, children }: { value: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md bg-surface px-3 py-2.5">
      <b className="font-display text-[1.25rem] font-semibold tabular-nums tracking-[-0.02em]">{value}</b>
      <span className="text-[0.76rem] text-muted">{children}</span>
    </div>
  );
}
