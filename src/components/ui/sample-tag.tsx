import { FlaskConical } from "lucide-react";

/**
 * The tag on the sample resume ("Try a sample resume"), wherever the resume is shown. It says nothing about gaps or
 * progress, so it takes the neutral chip style.
 */
export function SampleTag() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[0.68rem] font-medium uppercase tracking-[0.06em] text-ink">
      <FlaskConical size={12} strokeWidth={1.75} aria-hidden="true" />
      Sample
    </span>
  );
}

/** Today's note while the sample resume is the current one (T114): the ride and goals are the sample's. */
export function SampleLineNote() {
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2 text-[0.8rem] text-muted">
      <SampleTag />
      Your line comes from the sample resume. Upload your own to see your own gaps.
    </p>
  );
}

/** The confirm step's note on the sample resume: what it is, and how to swap in your own. */
export function SampleResumeNote() {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 text-sm">
      <span className="flex flex-wrap items-center gap-2 font-medium text-ink">
        Sample resume <SampleTag />
      </span>
      <p className="text-muted">
        A made-up data analyst, so you can see how CareerMetro works before adding your own. Check it, pick a role and see its gaps. Upload your own
        resume whenever you like; it takes over once you check it and see its gaps.
      </p>
    </div>
  );
}
