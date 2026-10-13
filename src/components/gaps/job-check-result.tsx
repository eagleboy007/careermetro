import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmKeyword } from "@/components/resume/confirm-keyword";
import { StatusChip } from "@/components/ui/status-chip";
import type { JobCheckView } from "@/lib/jobs/groups";
import { AddGoal, RemoveCheck, type GoalState } from "./job-check-actions";

const checkedOn = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** The heading id of a saved check, so the form can move focus to a new result. */
export const jobCheckHeadingId = (id: string) => `job-check-${id}`;

/**
 * What a visitor can do with a check's "Only for this job" skills: for an account, the skills already on its goals
 * and its own "Your choice" goals by skill (which it can remove); null skills for an anonymous visitor, who is asked
 * to sign in. `here` is the page to come back to after signing in.
 */
export type GoalsContext = { skills: readonly string[] | null; chosen?: Readonly<Record<string, string>>; here: string };

/** Where one skill stands for this visitor. */
export const goalState = (goals: GoalsContext, skillId: string): GoalState =>
  goals.skills === null ? "sign-in" : goals.skills.includes(skillId) ? "on" : "add";

export const signInHref = (here: string) => `/sign-in?next=${encodeURIComponent(here)}`;

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

export function Row({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-sm">
      <span className="min-w-0 break-words">{name}</span>
      {children && <span className="flex flex-wrap items-center justify-end gap-2">{children}</span>}
    </li>
  );
}

/**
 * One saved "Check against a job": what the posting asks for, sorted against the resume and the target role. Only the
 * matcher's statuses carry colour; the job itself never changes goals or the match, and the words say so.
 */
export function JobCheckResult({
  check,
  resumeId,
  roleTitle,
  planHref,
  goals,
  onRemoved,
  demo = false,
}: {
  check: JobCheckView;
  /** For "I have this" on skills the resume doesn't name (FR-34 screening check). */
  resumeId: string;
  roleTitle: string;
  /** The Path page for this job: "Plan for this job". */
  planHref: string;
  goals: GoalsContext;
  /** After "Remove this check": the list refreshes and moves focus. */
  onRemoved?: () => void;
  demo?: boolean;
}) {
  const asked = check.covered.length + check.alsoGoals.length + check.onlyThisJob.length;
  // Keywords this posting asks for that the resume doesn't name at all (FR-34): the person can confirm they have one.
  const unnamed = [...check.alsoGoals, ...check.onlyThisJob].filter((s) => s.status === "missing").length;
  const confirm = (s: { skillId: string; skillName: string; status: string }) =>
    s.status === "missing" ? <ConfirmKeyword resumeId={resumeId} keyword={{ skillId: s.skillId, skillName: s.skillName, options: [{ skillId: s.skillId, skillName: s.skillName }] }} demo={demo} /> : null;
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
        {unnamed > 0 && (
          <p className="text-sm text-muted">
            {unnamed === 1 ? "One skill marked Missing isn't named" : `${unnamed} skills marked Missing aren't named`} on your resume, and screening software
            looks for them. Have one? Press I have this.
          </p>
        )}
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
            {confirm(s)}
          </Row>
        ))}
      </Group>
      <Group
        title="Only for this job"
        note="These don't change your goals or your match. Add one as your own goal to work on it for this job."
        count={check.onlyThisJob.length}
      >
        {check.onlyThisJob.map((s) => (
          <Row key={s.skillId} name={s.skillName}>
            <StatusChip status={s.status} />
            {confirm(s)}
            <AddGoal
              checkId={check.id}
              skillId={s.skillId}
              skillName={s.skillName}
              state={goalState(goals, s.skillId)}
              goalId={goals.chosen?.[s.skillId] ?? null}
              signInHref={signInHref(goals.here)}
              demo={demo}
            />
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
      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line pt-3">
        {check.alsoGoals.length + check.onlyThisJob.length > 0 ? (
          <Link href={planHref} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink underline underline-offset-2">
            Plan for this job
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
        <RemoveCheck checkId={check.id} label={`${check.title} at ${check.company}`} onRemoved={onRemoved} demo={demo} />
      </div>
    </div>
  );
}
