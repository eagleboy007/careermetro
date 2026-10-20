import { PostedJobCard } from "@/components/corporate/job-parts";
import { JobReport } from "@/components/corporate/job-report";
import type { ApplyAction, ApplyPreviewAction, ApplyState, CanJoin, CriteriaView, JobReportAction, PostedJobView } from "@/lib/corporate/types";
import { ApplyPanel } from "./apply-panel";

/**
 * Jobs companies posted on CareerMetro (dev/corporate-plan.md build steps 3 and 4), above the other roles on
 * Departures. Only open jobs from verified companies reach here. Each card has Express apply, which previews what the
 * company receives before the consent and Send (pending item 16), or where the person's application stands, and the
 * job's Express apply criteria (met or not yet for the signed-in person). Without `report`, `apply` and `preview`
 * (signed out, /design) the forms ask the person to sign in.
 */
export function PostedJobs({
  jobs,
  report,
  apply,
  preview,
  states,
  criteria,
  canJoin,
}: {
  jobs: PostedJobView[];
  report?: JobReportAction;
  apply?: ApplyAction;
  preview?: ApplyPreviewAction;
  /** Per job id; a job missing here reads as signed out. */
  states?: Record<string, ApplyState>;
  /** Per job id, the job's criteria against the person's proofs; a job missing here shows its criteria by name. */
  criteria?: Record<string, CriteriaView>;
  /** Can join to prefill on applying, from the person's notice countdown while one runs; they can still change it. */
  canJoin?: CanJoin | null;
}) {
  if (!jobs.length) return null;
  return (
    <section aria-labelledby="posted-jobs-h" className="flex flex-col gap-3">
      <div>
        <h2 id="posted-jobs-h" className="text-[1.3rem] font-semibold leading-[1.15]">
          Posted on CareerMetro
        </h2>
        <p className="mt-1 max-w-[60ch] text-[0.88rem] text-muted">
          Jobs verified companies posted here, from our role profiles. Express apply shows you exactly what the company receives before you send, and you follow each step on Arrivals.
        </p>
      </div>
      <ul className="grid gap-3 min-[900px]:grid-cols-2">
        {jobs.map((j) => (
          <li key={j.id} className="min-w-0">
            <PostedJobCard
              job={j}
              criteria={criteria?.[j.id]}
              apply={states ? <ApplyPanel jobId={j.id} company={j.company} title={j.title} state={states[j.id] ?? { kind: "signed_out" }} action={apply} preview={preview} initialCanJoin={canJoin ?? undefined} /> : undefined}
              report={<JobReport jobId={j.id} title={j.title} action={report} />}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
