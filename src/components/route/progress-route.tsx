export const ROUTE_STEPS = ["Resume", "Gaps", "Path", "Practice", "Match"] as const;
export type RouteStep = (typeof ROUTE_STEPS)[number];

/**
 * The progress line shown at the top of every signed-in screen (DES-2).
 * Steps before `current` are done; cobalt always means progress.
 */
export function ProgressRoute({ current }: { current: RouteStep }) {
  const currentIndex = ROUTE_STEPS.indexOf(current);
  const filled = (currentIndex / (ROUTE_STEPS.length - 1)) * 80;

  return (
    <nav aria-label={`Progress: ${current}, step ${currentIndex + 1} of ${ROUTE_STEPS.length}`}>
      <ol className="relative flex">
        <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-[7px] h-0.5 bg-line" />
        <span
          aria-hidden="true"
          className="absolute left-[10%] top-[7px] h-0.5 bg-accent transition-[width] duration-500"
          style={{ width: `${filled}%` }}
        />
        {ROUTE_STEPS.map((step, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "now" : "next";
          return (
            <li
              key={step}
              aria-current={state === "now" ? "step" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1.5 text-[11px] ${
                state === "now" ? "font-semibold text-ink" : "text-muted"
              }`}
            >
              <span
                className={`size-4 rounded-full border-2 ${
                  state === "done"
                    ? "border-accent bg-accent"
                    : state === "now"
                      ? "border-accent bg-surface ring-4 ring-accent-soft"
                      : "border-line bg-surface"
                }`}
              />
              {step}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
