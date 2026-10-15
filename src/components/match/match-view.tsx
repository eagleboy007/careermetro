"use client";

import { ArrowRight, BriefcaseBusiness, Route } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { groupMatches } from "@/lib/match/group";
import type { MatchList, MatchRole } from "@/lib/schemas";
import { MATCH_HOURS, MATCH_MAX_WEEKS } from "@/lib/schemas/constants";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted";
const LINK = "inline-flex min-h-11 items-center gap-1 text-[0.84rem] font-[550] text-ink underline-offset-2 hover:underline";

const weeksWord = (n: number) => `${n} ${n === 1 ? "week" : "weeks"}`;

/** "about 3 weeks", or "Now" for a role that is ready. */
export const whenText = (weeks: number | null) => (weeks === null ? "Now" : `about ${weeksWord(weeks)}`);

/** The heading of the second group: the largest number of weeks in it. */
export const soonHeading = (within: number | null) => (within === null ? "Within a few weeks" : `Within ${weeksWord(within)}`);

/** The Departures link: how many open jobs it has for the role, or a plain link when the count couldn't be read. */
export function jobsText(jobs: number | null): string {
  if (jobs === null) return "Browse Departures";
  if (jobs === 0) return "No open jobs in Departures yet";
  return `${jobs} open ${jobs === 1 ? "job" : "jobs"} in Departures`;
}

/**
 * Match (handoff 12i, prototype v37): Ready now, then Within N weeks at the hours a week picked here (3, 6 or 10,
 * starting from the person's own). With no list (no resume yet), or nothing within 26 weeks at these hours, the empty
 * state. Cobalt is only the bar of required skills met, which is progress. Looking only: nothing here changes goals.
 */
export function MatchView({ list }: { list: MatchList | null }) {
  const id = useId();
  const [hours, setHours] = useState<number>(list?.weeklyHours ?? MATCH_HOURS[1]);
  const groups = list ? groupMatches(list.roles, hours) : null;
  const empty = !groups || (groups.ready.length === 0 && groups.soon.length === 0);
  const gapsHref = (slug: string) => (list?.resumeId ? `/resume/${list.resumeId}/gaps/${slug}` : `/roles/${slug}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">Match</h1>
          <p className="mt-1.5 max-w-[62ch] text-[0.92rem] text-muted">
            Roles you can go for now, and the ones a few weeks away. Worked out from your proved skills and the hours left on your path.
          </p>
        </div>
        {list && (
          <div className="inline-flex items-center gap-2">
            <label htmlFor={`${id}-hours`} className={LABEL}>
              I can give
            </label>
            <select
              id={`${id}-hours`}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="min-h-11 rounded-full border border-line-strong bg-surface px-3 text-[0.84rem] text-ink"
            >
              {MATCH_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} hours a week
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {empty || !groups ? (
        <section aria-labelledby={`${id}-empty`} className="mx-auto mt-3 flex max-w-[520px] flex-col items-center gap-3 rounded-lg border border-line bg-surface px-6 py-10 text-center">
          <Route size={30} className="text-muted" {...ICON} />
          <h2 id={`${id}-empty`} className="text-[1.25rem] font-semibold">
            No roles to show yet
          </h2>
          <p className="text-[0.9rem] leading-normal text-muted">
            {list
              ? `Nothing is within ${MATCH_MAX_WEEKS} weeks at ${hours} hours a week. More hours a week, or proving a goal, moves roles onto this list.`
              : "Add your resume and we'll show the roles you're ready for, and the ones a few weeks away. Proving a goal moves roles up this list."}
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            {!list && (
              <Link href="/today" className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-medium text-on-accent hover:opacity-90">
                Add your resume
              </Link>
            )}
            <Link href="/departures" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-ink hover:bg-surface-2">
              Browse departures
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby={`${id}-now`} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`${id}-now`} className="text-[1.15rem] font-semibold tracking-[-0.015em]">
                Ready now
              </h2>
              <span className={LABEL}>every required skill met or proved</span>
            </div>
            <ul className="grid gap-3 min-[760px]:grid-cols-2">
              {groups.ready.length ? (
                groups.ready.map((r) => <MatchCard key={r.slug} role={r} weeks={null} gapsHref={gapsHref(r.slug)} />)
              ) : (
                <None>None yet. Prove your next goal and the first role moves here.</None>
              )}
            </ul>
          </section>
          <section aria-labelledby={`${id}-soon`} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`${id}-soon`} className="text-[1.15rem] font-semibold tracking-[-0.015em]">
                {soonHeading(groups.within)}
              </h2>
              <span className={LABEL}>at {hours} hours a week</span>
            </div>
            <ul className="grid gap-3 min-[760px]:grid-cols-2">
              {groups.soon.length ? (
                groups.soon.map((s) => <MatchCard key={s.role.slug} role={s.role} weeks={s.weeks} gapsHref={gapsHref(s.role.slug)} />)
              ) : (
                <None>
                  Nothing within {MATCH_MAX_WEEKS} weeks at {hours} hours a week.
                </None>
              )}
            </ul>
          </section>
          <p className="flex items-start gap-2 text-[0.8rem] text-muted">
            <Route size={15} className="mt-px shrink-0" {...ICON} />
            Weeks = hours left on the goals that role still needs ÷ your hours a week. Roles more than {MATCH_MAX_WEEKS} weeks away stay off this list.
          </p>
        </>
      )}
    </div>
  );
}

function None({ children }: { children: ReactNode }) {
  return <li className="rounded-md border border-dashed border-line p-4 text-[0.86rem] text-muted">{children}</li>;
}

/** One role: weeks and path hours, the cobalt bar of required skills met, the goals still open, and where to go next. */
export function MatchCard({ role: r, weeks, gapsHref }: { role: MatchRole; weeks: number | null; gapsHref: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-line bg-surface px-[18px] py-4">
      <div className="flex items-start gap-2.5">
        <BriefcaseBusiness size={20} className="mt-0.5 shrink-0 text-muted" {...ICON} />
        <h3 className="min-w-0 flex-1 font-sans text-base font-semibold">
          {r.title}
          {r.onLine && (
            <>
              {" "}
              <span className="whitespace-nowrap rounded-full border border-line px-[7px] py-0.5 align-middle font-mono text-[0.62rem] font-normal uppercase tracking-[0.05em] text-muted">
                on your line
              </span>
            </>
          )}
        </h3>
        <p className="whitespace-nowrap text-right font-display text-[1.05rem] font-semibold tracking-[-0.01em]">
          {whenText(weeks)}
          <small className="block font-mono text-[0.64rem] font-normal uppercase tracking-[0.04em] text-muted">
            {weeks === null ? "ready" : `${r.hours} path ${r.hours === 1 ? "hour" : "hours"}`}
          </small>
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((r.met / r.required) * 100)}%` }} />
      </div>
      <p className="text-[0.82rem] text-muted">
        <b className="font-[550] text-ink">
          {r.met} of {r.required}
        </b>{" "}
        required skills met or proved
      </p>
      {r.open.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Goals still open">
          {r.open.map((g, i) => (
            <li key={`${i}-${g}`} className="rounded-full border border-dashed border-line px-[9px] py-0.5 text-[0.74rem] font-[550] text-ink">
              {g}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-wrap gap-x-4 border-t border-line pt-1.5">
        <Link href={gapsHref} className={LINK}>
          Gaps for this role
          <span className="sr-only">: {r.title}</span>
          <ArrowRight size={15} {...ICON} />
        </Link>
        <Link href="/departures" className={LINK}>
          {jobsText(r.jobs)}
          <span className="sr-only">: {r.title}</span>
          <ArrowRight size={15} {...ICON} />
        </Link>
      </div>
    </li>
  );
}
