import type { ReactNode } from "react";

/**
 * An on/off switch: a native checkbox under a drawn track, so it keeps keyboard, label and screen-reader behaviour.
 * On is ink, not cobalt: cobalt means progress only.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  children,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className={`flex min-h-11 items-center gap-3 text-[0.86rem] font-[550] ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <i
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-surface after:transition-[left] peer-checked:bg-ink peer-checked:after:left-[18px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      />
      <span className="min-w-0">
        {children}
        {hint && <small className="block text-[0.76rem] font-normal text-muted">{hint}</small>}
      </span>
    </label>
  );
}
