import { Check, CircleAlert, Clock, Contrast } from "lucide-react";
import type { GapStatus } from "@/lib/schemas";

const styles: Record<GapStatus, { label: string; className: string; Icon: typeof Check }> = {
  missing: { label: "Missing", className: "bg-bad-soft text-bad", Icon: CircleAlert },
  weak: { label: "Weak evidence", className: "bg-warn-soft text-warn", Icon: Contrast },
  outdated: { label: "Outdated", className: "bg-surface-2 text-muted", Icon: Clock },
  met: { label: "Met", className: "bg-good-soft text-good", Icon: Check },
};

export function StatusChip({ status, label }: { status: GapStatus; label?: string }) {
  const { label: defaultLabel, className, Icon } = styles[status];
  const text = label ?? defaultLabel;
  return (
    <span
      title={text}
      className={`inline-flex min-w-0 max-w-[16rem] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}
