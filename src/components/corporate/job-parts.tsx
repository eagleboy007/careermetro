import { Archive, CircleDot, CirclePause, FilePen, MapPin, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { CriteriaView, JobStatus, PostedJobView } from "@/lib/corporate/types";
import { APPLY_SOON_TEXT, JOB_STATUS_LABELS, JOB_WORK_TYPE_LABELS } from "@/lib/schemas/constants";
import { CriteriaAsked, CriteriaList } from "./criteria-parts";
import { AntiScamLine, ICON, OrgStatusBadge } from "./parts";

/*
 * Pieces of the jobs screens (handoff 12g, C9; C7 Jobs). Neutral styles only: cobalt means progress and red, amber
 * and green mean gap status, so a job's state is told by its word and icon.
 */

const STATUS_ICON = { draft: FilePen, open: CircleDot, paused: CirclePause, closed: Archive } as const;

/** "Draft", "Open", "Paused" or "Closed". */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${
        status === "open" ? "border border-ink/20 bg-surface-2 text-ink" : "bg-surface-2 text-muted"
      }`}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}

export const monoLabel = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const chip = "inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-[0.8rem] text-ink";
const lineChip = "inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[0.8rem] text-ink";

/** Skill names under a mono label. Nothing when the list is empty. */
function SkillRow({ label, children, empty }: { label: string; children: ReactNode[]; empty?: string }) {
  if (!children.length && !empty) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={monoLabel}>{label}</span>
      {children.length ? <ul className="flex flex-wrap gap-1.5">{children}</ul> : <p className="text-[0.84rem] text-muted">{empty}</p>}
    </div>
  );
}

/**
 * A job posted on CareerMetro as candidates see it on Departures, and as the live preview on Post a job. The company's
 * name and its Verified badge only: never its members, email or phone. `apply` is Express apply (Departures); without
 * it (the Post a job preview, /design) the button is off and says so in one line. `report` is Report this job. The
 * job's Express apply criteria show by name, or as met or not yet when `criteria` (the signed-in person's) is given.
 */
export function PostedJobCard({
  job,
  report,
  apply,
  criteria,
  headingLevel = 3,
}: {
  job: PostedJobView;
  report?: ReactNode;
  apply?: ReactNode;
  criteria?: CriteriaView;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const titleId = `job-${job.id}-title`;
  const noteId = `job-${job.id}-apply`;
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <div className="flex flex-wrap items-center gap-2 text-[0.86rem]">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-sm bg-surface-2 text-[0.8rem] font-semibold">
          {job.company.trim()[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{job.company}</span>
        <OrgStatusBadge status="verified" />
      </div>
      <H id={titleId} className="text-[1.15rem] font-semibold leading-[1.2] tracking-[-0.015em] [overflow-wrap:anywhere]">
        {job.title || "Job title"}
      </H>
      <ul aria-label="Where and how" className="flex flex-wrap gap-1.5">
        <li className={lineChip}>
          <MapPin {...ICON} size={14} />
          {job.city || "City"}
        </li>
        <li className={lineChip}>{JOB_WORK_TYPE_LABELS[job.workType]}</li>
        <li className={lineChip}>Posted {formatDay(job.postedOn)}</li>
      </ul>
      <SkillRow label="Required" empty="Add at least one">
        {job.required.map((s) => (
          <li key={s} className={chip}>
            {s}
          </li>
        ))}
      </SkillRow>
      <SkillRow label="One of these">
        {job.oneOf.map((g) => (
          <li key={g.join("|")} className={lineChip}>
            {g.join(" or ")}
          </li>
        ))}
      </SkillRow>
      <SkillRow label="Nice to have">
        {job.nice.map((s) => (
          <li key={s} className={`${lineChip} text-muted`}>
            {s}
          </li>
        ))}
      </SkillRow>
      {criteria && criteria.total > 0 ? <CriteriaList criteria={criteria} compact /> : <CriteriaAsked names={job.criteria} />}
      {apply ?? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            disabled
            aria-describedby={noteId}
            className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border border-line bg-surface-2 px-4 text-[0.86rem] font-medium text-muted disabled:cursor-not-allowed"
          >
            <Zap {...ICON} />
            Express apply
          </button>
          <p id={noteId} className="text-[0.8rem] text-muted">
            {APPLY_SOON_TEXT}
          </p>
        </div>
      )}
      <AntiScamLine />
      {report}
    </article>
  );
}
