import { PostedJobCard } from "@/components/corporate/job-parts";
import { JobReport } from "@/components/corporate/job-report";
import type { JobReportAction, PostedJobView } from "@/lib/corporate/types";

/**
 * Jobs companies posted on CareerMetro (dev/corporate-plan.md build step 3), above the other roles on Departures. Only
 * open jobs from verified companies reach here. Applying here comes next; each card says so. Without `report` (signed
 * out, /design) the Report form asks the person to sign in.
 */
export function PostedJobs({ jobs, report }: { jobs: PostedJobView[]; report?: JobReportAction }) {
  if (!jobs.length) return null;
  return (
    <section aria-labelledby="posted-jobs-h" className="flex flex-col gap-3">
      <div>
        <h2 id="posted-jobs-h" className="text-[1.3rem] font-semibold leading-[1.15]">
          Posted on CareerMetro
        </h2>
        <p className="mt-1 max-w-[60ch] text-[0.88rem] text-muted">Jobs verified companies posted here, from our role profiles.</p>
      </div>
      <ul className="grid gap-3 min-[900px]:grid-cols-2">
        {jobs.map((j) => (
          <li key={j.id} className="min-w-0">
            <PostedJobCard job={j} report={<JobReport jobId={j.id} title={j.title} action={report} />} />
          </li>
        ))}
      </ul>
    </section>
  );
}
