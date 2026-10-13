import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { ApplyHere } from "@/components/route/apply-here";
import { MarkDone } from "@/components/route/mark-done";
import { PathEnd, type PathNext } from "@/components/route/path-end";
import { PathSteps } from "@/components/route/path-steps";
import { ProgressRoute } from "@/components/route/progress-route";
import { SiteHeader } from "@/components/site/site-header";
import { roleProfiles } from "@/content";
import { authConfig } from "@/lib/auth/config";
import { currentAccount } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";
import { inPathOrder } from "@/lib/jobs/groups";
import { goalSkillsOf, ownJobCheck, type OwnJobCheck } from "@/lib/jobs/store";
import type { Owner } from "@/lib/owner";
import { getPathForOwner } from "@/lib/path/store";
import { DEFAULT_WEEKLY_HOURS, WEEKLY_HOURS } from "@/lib/schemas";
import { readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

export const metadata: Metadata = { title: "Your path · CareerMetro", robots: { index: false } };

// Learning works toward a gap; only proof fills it, so the step never says it closes one. Same words as the Gaps page.
const STATUS_WORDS = { missing: "not on your resume yet", weak: "weak on your resume", outdated: "out of date on your resume" } as const;
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** The hours in the link, else the signed-in person's saved hours a week, else the default. */
function readHours(value: string | string[] | undefined, saved: number | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  if ((WEEKLY_HOURS as readonly number[]).includes(n)) return n;
  return saved !== undefined && (WEEKLY_HOURS as readonly number[]).includes(saved) ? saved : DEFAULT_WEEKLY_HOURS;
}

/**
 * "Plan for this job" (`?job=<check id>`): the saved check and the visitor's goal skills, only when the check is the
 * owner's own and was made for this resume and role. Anything else, or a failure, is ignored and the normal path shows.
 */
async function jobPlan(value: string | string[] | undefined, owner: Owner, resumeId: string, roleSlug: string) {
  const checkId = Array.isArray(value) ? value[0] : value;
  if (!checkId) return null;
  try {
    const [own, skills] = await Promise.all([ownJobCheck(checkId, owner), owner.userId !== undefined ? goalSkillsOf(owner.userId) : null]);
    if (!own || own.resumeId !== resumeId || own.roleSlug !== roleSlug) return null;
    return { own, skills: skills?.skills ?? null, chosen: skills?.chosen };
  } catch (error) {
    logEvent("error", "job_plan_failed", { route: "/resume/[id]/path/[slug]", role: roleSlug, ...errorFields(error) });
    return null;
  }
}

async function Path({ params, searchParams }: PageProps<"/resume/[id]/path/[slug]">) {
  // Per-request data: the lookup reads the clock and the session cookie.
  await connection();
  const { id, slug } = await params;
  const role = roleProfiles.find((r) => r.slug === slug);
  if (!role) notFound();
  const owner = await readOwner();
  const account = owner && "userId" in owner ? await currentAccount() : null;
  const query = await searchParams;
  const hours = readHours(query.hours, account?.weeklyHours);
  let result: Awaited<ReturnType<typeof getPathForOwner>>;
  try {
    result = owner ? await getPathForOwner(id, owner, role, hours) : { ok: false, reason: "not_found" };
  } catch (error) {
    // Database errors carry query parameters; errorFields keeps only the name and code.
    logEvent("error", "path_failed", { route: "/resume/[id]/path/[slug]", role: slug, hours, ...errorFields(error) });
    return <TryAgain />;
  }
  if (!result.ok && result.reason === "not_found") return <ResumeNotFound />;
  if (!result.ok && result.reason === "busy") return <TryAgain />;
  if (!result.ok && result.reason === "not_confirmed") {
    return (
      <p className="rounded-lg border border-line bg-surface p-5 text-sm">
        First check your resume and press <strong>Looks right</strong>.{" "}
        <Link href={`/resume/${id}`} className="font-medium underline underline-offset-2">
          Check your resume
        </Link>
      </p>
    );
  }
  if (!result.ok) {
    return (
      <p className="rounded-lg border border-line bg-surface p-5 text-sm">
        Your resume already shows every required skill for {role.title}, so there is nothing to add to a path.
      </p>
    );
  }

  const { path } = result;
  const share = path.steps.length ? path.doneCount / path.steps.length : 0;
  const plan: { own: OwnJobCheck; skills: string[] | null; chosen?: Record<string, string> } | null = owner ? await jobPlan(query.job, owner, id, slug) : null;
  const jobQuery = plan ? `&job=${plan.own.view.id}` : "";
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">{role.title}</p>
        <h1 className="text-4xl font-semibold leading-[1.05]">Your path</h1>
        <p className="text-muted">
          {path.steps.length} {path.steps.length === 1 ? "step" : "steps"}, about {path.totalHours} hours: roughly {path.weeks}{" "}
          {path.weeks === 1 ? "week" : "weeks"} at {path.weeklyHours} hours a week.
        </p>
      </section>

      {plan && (
        <ApplyHere
          checkId={plan.own.view.id}
          company={plan.own.view.company}
          title={plan.own.view.title}
          alsoGoals={inPathOrder(
            plan.own.view.alsoGoals,
            path.steps.map((s) => s.skillId),
          )}
          onlyThisJob={plan.own.view.onlyThisJob}
          goals={{ skills: plan.skills, chosen: plan.chosen, here: `/resume/${id}/path/${slug}?job=${plan.own.view.id}` }}
        />
      )}

      <nav aria-label="Hours a week" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Hours a week:</span>
        {WEEKLY_HOURS.map((h) => (
          <Link
            key={h}
            href={`/resume/${id}/path/${slug}?hours=${h}${jobQuery}`}
            aria-current={h === path.weeklyHours ? "page" : undefined}
            aria-label={`${h} hours a week`}
            className={`rounded-full border px-3 py-1 font-mono text-xs ${
              h === path.weeklyHours ? "border-ink bg-ink text-bg" : "border-line hover:border-ink"
            }`}
          >
            {h}
          </Link>
        ))}
      </nav>

      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4" aria-label="Progress">
        <p className="text-sm font-semibold">
          {path.doneCount} of {path.steps.length} steps done
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
        </div>
      </section>

      <PathSteps
        steps={path.steps.map((s) => ({
          key: s.id,
          title: s.skillName,
          hours: s.hours,
          week: s.week,
          reason: s.reason,
          closes: `${s.skillName} (${STATUS_WORDS[s.status]})`,
          doneOn: s.doneAt ? dayMonth.format(new Date(s.doneAt)) : undefined,
          resources: s.resources,
          proofTask: s.proofTask,
          action: <MarkDone stepId={s.id} title={s.skillName} done={Boolean(s.doneAt)} />,
        }))}
      />
      {path.steps.length > 0 && path.doneCount === path.steps.length && <PathEnd next={pathNext(!!account, `/resume/${id}/path/${slug}`)} />}
      {path.deferredCount > 0 && (
        <p className="text-sm text-muted">
          {path.deferredCount === 1 ? "One more gap waits" : `${path.deferredCount} more gaps wait`} for after this path, to keep it
          short. More hours a week fits more in.
        </p>
      )}
      <p className="text-xs text-muted">All resources are free. Hours are a rough estimate.</p>
      <p className="text-sm text-muted">
        <Link href={`/resume/${id}/gaps/${slug}`} className="underline underline-offset-2 hover:text-ink">
          Back to your gaps
        </Link>
      </p>
    </div>
  );
}

/** After the last step: Today for a signed-in person, else sign in where accounts are on, else the waitlist. */
function pathNext(signedIn: boolean, here: string): PathNext {
  if (signedIn) return { kind: "today" };
  if (authConfig() || testSignInEnabled()) return { kind: "sign-in", href: `/sign-in?next=${encodeURIComponent(here)}` };
  return { kind: "waitlist" };
}

function TryAgain() {
  return (
    <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
      We couldn&apos;t build your path just now. Please reload the page in a minute.
    </p>
  );
}

export default function PathPage(props: PageProps<"/resume/[id]/path/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Path" />
      <Suspense fallback={<p className="text-sm text-muted">Building your path…</p>}>
        <Path {...props} />
      </Suspense>
    </main>
  );
}
