import { ChevronDown } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import type { GapStatus } from "@/lib/schemas";

export type CoveredSkill = { skillId: string; skillName: string; status: GapStatus };

/** A collapsed list of skills, such as the ones the resume already shows, with each one's status. */
export function CoveredSkills({ title, skills, open = false }: { title: string; skills: CoveredSkill[]; open?: boolean }) {
  if (skills.length === 0) return null;
  return (
    <details open={open} className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          {title} <span className="font-mono text-xs font-normal text-muted">({skills.length})</span>
        </span>
        <ChevronDown size={18} strokeWidth={1.75} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="flex flex-col gap-2 border-t border-line px-4 py-3">
        {skills.map((s) => (
          <li key={s.skillId} className="flex items-center justify-between gap-3 text-sm">
            <span>{s.skillName}</span>
            <StatusChip status={s.status} />
          </li>
        ))}
      </ul>
    </details>
  );
}
