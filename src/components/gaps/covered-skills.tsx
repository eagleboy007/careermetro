import { StatusChip } from "@/components/ui/status-chip";
import type { GapStatus } from "@/lib/schemas";

export type CoveredSkill = { skillId: string; skillName: string; status: GapStatus };

/** A collapsed list of skills, such as the ones the resume already shows, with each one's status. */
export function CoveredSkills({ title, skills, open = false }: { title: string; skills: CoveredSkill[]; open?: boolean }) {
  if (skills.length === 0) return null;
  return (
    <details open={open} className="group rounded-lg border border-line bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 font-semibold marker:hidden">
        {title} <span className="font-mono text-xs font-normal text-muted">({skills.length})</span>
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
