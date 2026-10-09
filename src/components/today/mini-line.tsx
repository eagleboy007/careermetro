import { TrainFront } from "lucide-react";
import { trainPosition } from "@/lib/today/logic";

const W = 600;
const PAD = 20;

/**
 * The strip of line on the ride card: cleared stops in cobalt, the dotted prep stretch to the current pitstop
 * with the train on it, and stops ahead in grey. Decorative; the ride card says the same in words.
 */
export function MiniLine({ stops, currentIndex, progress }: { stops: readonly string[]; currentIndex: number; progress: number }) {
  const step = (W - PAD * 2) / (stops.length - 1);
  const x = (i: number) => PAD + i * step;
  const pct = (i: number) => `${(x(i) / W) * 100}%`;
  const arrived = progress >= 1;
  const cleared = arrived ? currentIndex : currentIndex - 1;
  const train = trainPosition(currentIndex, progress);
  const from = Math.max(0, currentIndex - 1);

  return (
    <div className="relative mt-1 h-[74px]" aria-hidden="true">
      <svg viewBox={`0 0 ${W} 74`} preserveAspectRatio="none" className="block size-full overflow-visible">
        <line x1={PAD} y1={40} x2={W - PAD} y2={40} className="stroke-line" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {cleared > 0 && (
          <line x1={PAD} y1={40} x2={x(cleared)} y2={40} className="stroke-accent" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        )}
        {currentIndex > 0 && !arrived && (
          <>
            <line x1={x(from)} y1={40} x2={x(currentIndex)} y2={40} className="stroke-surface" strokeWidth={6} vectorEffect="non-scaling-stroke" />
            <line
              x1={x(from)}
              y1={40}
              x2={x(currentIndex)}
              y2={40}
              className="stroke-accent"
              strokeWidth={4}
              strokeDasharray="2 7"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={x(from)}
              y1={40}
              x2={x(train)}
              y2={40}
              className="stroke-accent transition-all duration-700"
              strokeWidth={6}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      {stops.map((label, i) => {
        const done = i <= cleared;
        const big = i >= stops.length - 2;
        const now = i === (arrived ? currentIndex + 1 : currentIndex);
        return (
          <span key={`${label}-${i}`}>
            <span
              className={`absolute top-[40px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] ${big ? "size-4" : "size-3"} ${
                done ? "border-accent bg-accent" : "border-line bg-surface"
              }`}
              style={{ left: pct(i) }}
            />
            <span
              className={`absolute top-[54px] -translate-x-1/2 font-mono text-[10.5px] uppercase tracking-wider ${
                now ? "font-semibold text-ink" : "text-muted"
              } ${big ? "hidden sm:inline" : ""}`}
              style={{ left: pct(i) }}
            >
              {label}
            </span>
          </span>
        );
      })}
      <span
        className="absolute top-1 flex -translate-x-1/2 flex-col items-center gap-[3px] transition-[left] duration-1000 ease-[cubic-bezier(.3,.9,.2,1)]"
        style={{ left: pct(train) }}
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-accent py-[3px] pl-[7px] pr-[9px] text-[0.72rem] font-semibold text-on-accent shadow-raised">
          <TrainFront size={14} strokeWidth={1.75} />
          You
        </span>
        <span className="h-[9px] w-0.5 bg-accent" />
      </span>
    </div>
  );
}
