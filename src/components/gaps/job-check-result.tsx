import type { ReactNode } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import type { JobCheckView } from "@/lib/jobs/groups";

const checkedOn = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** The heading id of a saved check, so the form can move focus to a new result. */
export const jobCheckHeadingId = (id: string) => `job-check-${id}`;

function Group({ title, note, count, children }: { title: string; note?: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3">
      <h4 className="font-sans text-sm font-semibold tracking-normal">
        {title} <span className="font-mono text-xs font-normal text-muted">({count})</span>
      </h4>
      {note && <p className="text-xs text-muted">{note}</p>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 break-words">{name}</span>
      {children}
    </li>
  );
}

/**
 * One saved "Check against a job": what the posting asks for, sorted against the resume and the target role. Only the
 * matcher's statuses carry colour; the job itself never changes goals or the match, and the words say so.
 */
export function JobCheckResult({ check, roleTitle }: { check: JobCheckView; roleTitle: string }) {
  const asked = check.covered.length + check.alsoGoals.length + check.onlyThisJob.length;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h3 id={jobCheckHeadingId(check.id)} tabIndex={-1} className="font-sans text-base font-semibold tracking-normal focus:outline-2 focus:outline-offset-2 focus:outline-ink">
          {check.title} <span className="font-normal text-muted">at</span> {check.company}
        </h3>
        <p className="font-mono text-xs text-muted">Checked {checkedOn.format(new Date(check.createdAt))}</p>
        <p className="text-sm">
          {asked === 0
            ? "This posting asks for no skills we can check yet."
            : `You cover ${check.covered.length} of the ${asked} skills this job asks for.`}
        </p>
      </div>
      <Group title="Covered" count={check.covered.length}>
        {check.covered.map((s) => (
          <Row key={s.skillId} name={s.skillName}>
            <StatusChip status="met" label={s.by === "proof" ? "Proved" : "On your resume"} />
          </Row>
        ))}
      </Group>
      <Group title="Your goals this job also asks for" count={check.alsoGoals.length}>
        {check.alsoGoals.map((s) => (
          <Row key={s.skillId} name={s.skillName}>
            <StatusChip status={s.status} />
          </Row>
        ))}
      </Group>
      <Group title="Only for this job" note="These don't change your goals or your match." count={check.onlyThisJob.length}>
        {check.onlyThisJob.map((s) => (
          <Row key={s.skillId} name={s.skillName}>
            <StatusChip status={s.status} />
          </Row>
        ))}
      </Group>
      <Group title="Not asked for this job" note={`These stay your goals for ${roleTitle}.`} count={check.notAsked.length}>
        {check.notAsked.map((s) => (
          <Row key={s.skillId} name={s.skillName} />
        ))}
      </Group>
      <Group title="Good to have" note="This job would like these. They are never counted as gaps." count={check.goodToHave.length}>
        {check.goodToHave.map((s) => (
          <Row key={s.skillId} name={s.skillName}>
            <StatusChip status={s.status} />
          </Row>
        ))}
      </Group>
      <Group title="Not in our skill list yet" note="We can't check these yet, so they aren't counted." count={check.unknown.length}>
        {check.unknown.map((name) => (
          <Row key={name} name={name} />
        ))}
      </Group>
    </div>
  );
}
