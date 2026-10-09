import type { LampStatus } from "@/lib/schemas/today";
import { LAMP_WORD } from "@/lib/today/logic";

const LIT: Record<LampStatus, number> = { missing: 0, weak: 1, met: 2 };
const GLOW = ["bg-bad shadow-[0_0_6px_var(--bad)]", "bg-warn shadow-[0_0_6px_var(--warn)]", "bg-good shadow-[0_0_6px_var(--good)]"];

/** Three signal lamps: red missing, amber weak, green met. `label` adds the word, because status is never colour alone. */
export function Lamp({ status, label = false }: { status: LampStatus; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="flex h-3.5 w-[30px] shrink-0 items-center justify-around rounded-full bg-surface-2 px-[3px]"
        role="img"
        aria-label={LAMP_WORD[status]}
      >
        {GLOW.map((glow, i) => (
          <i key={i} className={`size-1.5 rounded-full ${i === LIT[status] ? glow : "bg-line"}`} />
        ))}
      </span>
      {label && <span className="font-mono text-[0.68rem] uppercase tracking-wider text-muted">{LAMP_WORD[status]}</span>}
    </span>
  );
}
