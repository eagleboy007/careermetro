import Link from "next/link";

export const ROUTE_STEPS = ["Resume", "Gaps", "Path", "Practice", "Match"] as const;
export type RouteStep = (typeof ROUTE_STEPS)[number];
/** Steps not built yet: shown as coming soon, never as the next thing to do. */
const COMING_SOON: readonly RouteStep[] = [];
/** Steps with a screen of their own that the line can open (signed in only; the proxy asks anyone else to sign in). */
const STEP_LINKS: Partial<Record<RouteStep, string>> = { Practice: "/practice", Match: "/match" };

/**
 * The progress line shown at the top of every signed-in screen (DES-2).
 * Steps before `current` are done; cobalt always means progress. With `linked`, the steps ahead that have their own
 * screen (Practice, Match) are links to it, as on the Path page.
 */
export function ProgressRoute({ current, linked = false }: { current: RouteStep; linked?: boolean }) {
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
          const soon = state === "next" && COMING_SOON.includes(step);
          const href = linked && state === "next" && !soon ? STEP_LINKS[step] : undefined;
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
                      : soon
                        ? "border-line bg-surface-2"
                        : "border-line bg-surface"
                }`}
              />
              {href ? (
                <Link href={href} className="-my-2 inline-flex min-h-6 items-center px-1 underline-offset-2 hover:text-ink hover:underline">
                  {step}
                </Link>
              ) : (
                step
              )}
              {soon && (
                <>
                  <span className="sr-only">, coming soon</span>
                  <span aria-hidden="true" className="-mt-1 font-mono text-[10px] uppercase tracking-wider text-muted">
                    Soon
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
