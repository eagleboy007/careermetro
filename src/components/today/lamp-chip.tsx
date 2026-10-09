import { Check, CircleAlert, Contrast } from "lucide-react";
import type { LampStatus } from "@/lib/schemas/today";
import { LAMP_WORD } from "@/lib/today/logic";

const STYLE: Record<LampStatus, { className: string; Icon: typeof Check }> = {
  missing: { className: "bg-bad-soft text-bad", Icon: CircleAlert },
  weak: { className: "bg-warn-soft text-warn", Icon: Contrast },
  met: { className: "bg-good-soft text-good", Icon: Check },
};

/** A skill name in its gap colour, with an icon so status is never colour alone. */
export function LampChip({ status, label }: { status: LampStatus; label: string }) {
  const { className, Icon } = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      {label}
      <span className="sr-only">, {LAMP_WORD[status]}</span>
    </span>
  );
}
