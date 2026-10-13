import { AddGoal } from "@/components/gaps/job-check-actions";
import { goalState, Row, signInHref, type GoalsContext } from "@/components/gaps/job-check-result";
import { StatusChip } from "@/components/ui/status-chip";
import type { JobCheckSkill } from "@/lib/jobs/groups";

/**
 * "To apply here, close these first" on the Path page for one saved job (role-suggest-plan.md part B, item 3): that
 * job's open gaps, first the person's goals the job also asks for in path order, then the skills only this job asks
 * for. The stored path itself doesn't change. `demo` saves nothing (for /design).
 */
export function ApplyHere({
  checkId,
  company,
  title,
  alsoGoals,
  onlyThisJob,
  goals,
  demo = false,
}: {
  checkId: string;
  company: string;
  title: string;
  /** In path order. */
  alsoGoals: JobCheckSkill[];
  onlyThisJob: JobCheckSkill[];
  goals: GoalsContext;
  demo?: boolean;
}) {
  const count = alsoGoals.length + onlyThisJob.length;
  return (
    <section aria-labelledby={`apply-${checkId}`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">
          {title} at {company}
        </p>
        <h2 id={`apply-${checkId}`} className="font-sans text-lg font-semibold tracking-normal">
          To apply here, close these first
        </h2>
        <p className="text-sm text-muted">
          {count === 0
            ? "You already cover every skill this job asks for that we can check."
            : "This job's open gaps. Your path below stays as it is."}
        </p>
      </div>
      {alsoGoals.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="font-sans text-sm font-semibold tracking-normal">Your goals this job also asks for</h3>
          <ol className="flex flex-col gap-2">
            {alsoGoals.map((s) => (
              <Row key={s.skillId} name={s.skillName}>
                <StatusChip status={s.status} />
              </Row>
            ))}
          </ol>
        </section>
      )}
      {onlyThisJob.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="font-sans text-sm font-semibold tracking-normal">Only for this job</h3>
          <p className="text-xs text-muted">These don&apos;t change your goals or your match unless you add them.</p>
          <ul className="flex flex-col gap-2">
            {onlyThisJob.map((s) => (
              <Row key={s.skillId} name={s.skillName}>
                <StatusChip status={s.status} />
                <AddGoal
                  checkId={checkId}
                  skillId={s.skillId}
                  skillName={s.skillName}
                  state={goalState(goals, s.skillId)}
                  goalId={goals.chosen?.[s.skillId] ?? null}
                  signInHref={signInHref(goals.here)}
                  demo={demo}
                />
              </Row>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
