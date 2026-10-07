import { Award } from "lucide-react";
import type { RoleCertificationView } from "@/lib/role-view";

const levelLabel: Record<RoleCertificationView["level"], string> = {
  entry: "Entry",
  associate: "Associate",
  professional: "Professional",
  specialty: "Specialty",
  advanced: "Advanced",
  expert: "Expert",
};

/** Certifications for a role, recommended first. */
export function CertificationList({ certifications }: { certifications: RoleCertificationView[] }) {
  if (certifications.length === 0) {
    return <p className="text-sm text-muted">No certification is commonly asked for in this role. Projects count for more.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {certifications.map((c) => (
        <li key={c.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start gap-3">
            <Award size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-muted">{c.issuer}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 font-mono text-[11px] uppercase tracking-wider">
            <span className={`rounded-full px-2 py-0.5 ${c.importance === "recommended" ? "bg-ink text-bg" : "border border-line text-muted"}`}>
              {c.importance === "recommended" ? "Recommended" : "Optional"}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 text-muted">{levelLabel[c.level]}</span>
            {c.cost === "free" && <span className="rounded-full border border-line px-2 py-0.5 text-muted">Free</span>}
          </div>
          <p className="text-sm">{c.why}</p>
        </li>
      ))}
    </ul>
  );
}
