import { FlaskConical } from "lucide-react";
import { localMockActive } from "@/lib/ai/local-mock";

/** Says when resumes are read by the local stand-in, which returns the same sample profile for every resume. `demo` shows it anyway (/design). */
export function LocalTestNotice({ demo = false }: { demo?: boolean }) {
  if (!demo && !localMockActive()) return null;
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-line bg-surface-2 px-3.5 py-2 text-[0.85rem] text-ink">
      <FlaskConical size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        <b className="font-semibold">Local test mode.</b> Every resume is read as the sample profile Priya Sharma, a data analyst, whatever you
        upload. To read your own resume, use a real Claude key (docs/local-setup.md).
      </span>
    </p>
  );
}
