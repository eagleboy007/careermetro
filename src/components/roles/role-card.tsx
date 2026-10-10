import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { plural } from "@/components/map/map-parts";
import { scoredSkills, type RoleView } from "@/lib/role-view";

/** A role in the roles list. */
export function RoleCard({ role }: { role: RoleView }) {
  const core = scoredSkills(role);
  const top = core.slice(0, 3).map((s) => s.name);
  return (
    <Link
      href={`/roles/${role.slug}`}
      className="group flex flex-col gap-3 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-ink"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold leading-snug">{role.title}</h2>
        <ArrowRight size={18} strokeWidth={1.75} className="mt-1 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
      </div>
      <p className="font-mono text-xs uppercase tracking-wider text-muted">
        {role.experience} · {plural(core.length, "core skill")} · {plural(role.certifications.length, "certification")}
      </p>
      {top.length > 0 && <p className="text-sm text-muted">Most asked: {top.join(", ")}</p>}
    </Link>
  );
}
