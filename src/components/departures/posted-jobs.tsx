import { PostedJobCard } from "@/components/corporate/job-parts";
import { JobReport } from "@/components/corporate/job-report";
import type { ApplyAction, ApplyState, JobReportAction, PostedJobView } from "@/lib/corporate/types";
import { ApplyPanel } from "./apply-panel";

/**
 * Jobs companies posted on CareerMetro (dev/corporate-plan.md build steps 3 and 4), above the other roles on
 * Departures. Only open jobs from verified companies reach here. Each card has Apply on CareerMetro with its consent,
 * or where the person's application stands. Without `report` and `apply` (signed out, /design) the forms ask the person
 * to sign in.
 */
export function PostedJobs({
  jobs,
  report,
  apply,
  states,
}: {
  jobs: PostedJobView[];
  report?: JobReportAction;
  apply?: ApplyAction;
  /** Per job id; a job missing here reads as signed out. */
  states?: Record<string, ApplyState>;
}) {
  if (!jobs.length) return null;
  return (
    <section aria-labelledby="posted-jobs-h" className="flex flex-col gap-3">
      <div>
        <h2 id="posted-jobs-h" className="text-[1.3rem] font-semibold leading-[1.15]">
          Posted on CareerMetro
        </h2>
        <p className="mt-1 max-w-[60ch] text-[0.88rem] text-muted">Jobs verified companies posted here, from our role profiles. Apply here and follow each step on Arrivals.</p>
      </div>
      <ul className="grid gap-3 min-[900px]:grid-cols-2">
        {jobs.map((j) => (
          <li key={j.id} className="min-w-0">
            <PostedJobCard
              job={j}
              apply={states ? <ApplyPanel jobId={j.id} company={j.company} title={j.title} state={states[j.id] ?? { kind: "signed_out" }} action={apply} /> : undefined}
              report={<JobReport jobId={j.id} title={j.title} action={report} />}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
