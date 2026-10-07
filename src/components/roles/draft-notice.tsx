import { Info } from "lucide-react";

/** Shown on role content until a domain expert has reviewed it. */
export function DraftNotice() {
  return (
    <p className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-4 text-sm">
      <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
      <span>
        Draft. Built from public job postings and still being reviewed by people who hire for these roles. Expect small
        changes.
      </span>
    </p>
  );
}
