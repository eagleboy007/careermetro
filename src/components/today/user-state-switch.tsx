import Link from "next/link";
import type { UserState } from "@/lib/schemas/today";

const STATES: { state: UserState; label: string }[] = [
  { state: "returning", label: "Returning" },
  { state: "first_signup", label: "First sign-up" },
  { state: "no_resume", label: "No resume" },
];

/**
 * Preview only: switch the sample user between the three Today states. Real users never see this; their state is
 * picked on the server (handoff 4).
 */
export function UserStateSwitch({ current, basePath }: { current: UserState; basePath: string }) {
  return (
    <nav aria-label="Sample user state" className="inline-flex flex-wrap items-center gap-1 rounded-full border border-dashed border-line p-1">
      <span className="px-2 font-mono text-[0.66rem] uppercase tracking-wider text-muted">Preview</span>
      {STATES.map(({ state, label }) => (
        <Link
          key={state}
          href={`${basePath}?state=${state}`}
          aria-current={state === current ? "page" : undefined}
          scroll={false}
          className="rounded-full px-3 py-1 text-[0.78rem] font-medium text-muted hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
