import { Info } from "lucide-react";
import Link from "next/link";
import { CERTIFICATE_NOT_CONFIRMED_MESSAGE } from "@/lib/proofs/messages";

/**
 * On a goal whose certificate was rejected after review (FR-44): it couldn't be confirmed for this person, with a link
 * to Grievances. Neutral styling: red, amber and green are for gap status only.
 */
export function NotConfirmedNote() {
  return (
    <p className="flex gap-2 rounded-[14px] bg-surface-2 px-3 py-2.5 text-[0.84rem] text-ink">
      <Info size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        {CERTIFICATE_NOT_CONFIRMED_MESSAGE}{" "}
        <Link href="/grievances" className="underline underline-offset-2">
          Go to Grievances
        </Link>
      </span>
    </p>
  );
}
