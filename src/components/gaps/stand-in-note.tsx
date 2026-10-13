import { ChevronDown, Info } from "lucide-react";

/**
 * Says plainly that a job posting stands in as the target until we add the role (role-suggest-plan.md part B, point
 * 4), and that its gaps make no goals or path. Neutral colours: it is information, not progress or a gap status.
 */
export function StandInNote({ title }: { title: string }) {
  return (
    <div role="note" aria-label="About these gaps" className="flex gap-3 rounded-lg border border-line bg-surface p-4">
      <Info size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">This job posting stands in until we add the role</p>
        <p className="text-sm text-muted">
          <span className="break-words">{title}</span> isn&apos;t in our role list yet, so these gaps are what this one posting asks for, checked
          against your resume. They don&apos;t become goals or a path; pick a role from our list for those.
        </p>
      </div>
    </div>
  );
}

/** Skill names a posting asks for that our skill list doesn't have yet: shown, never scored. */
export function UnknownSkills({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          Not in our skill list yet <span className="font-mono text-xs font-normal text-muted">({names.length})</span>
        </span>
        <ChevronDown size={18} strokeWidth={1.75} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        <p className="text-xs text-muted">We can&apos;t check these yet, so they aren&apos;t counted.</p>
        <ul className="flex flex-col gap-2">
          {names.map((name) => (
            <li key={name} className="break-words text-sm">
              {name}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
