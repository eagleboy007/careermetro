import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { MarkDone } from "@/components/route/mark-done";
import { PathSteps } from "@/components/route/path-steps";
import { ProgressRoute } from "@/components/route/progress-route";
import { SiteHeader } from "@/components/site/site-header";
import { roleProfiles } from "@/content";
import { getPathForOwner } from "@/lib/path/store";
import { DEFAULT_WEEKLY_HOURS, WEEKLY_HOURS } from "@/lib/schemas";
import { readOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Your path · CareerMetro", robots: { index: false } };

const STATUS_LABEL = { missing: "Missing gap", weak: "Weak evidence", outdated: "Outdated" } as const;
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

function readHours(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (WEEKLY_HOURS as readonly number[]).includes(n) ? n : DEFAULT_WEEKLY_HOURS;
}

async function Path({ params, searchParams }: PageProps<"/resume/[id]/path/[slug]">) {
  // Per-request data: the lookup reads the clock and the session cookie.
  await connection();
  const { id, slug } = await params;
  const role = roleProfiles.find((r) => r.slug === slug);
  if (!role) notFound();
  const hours = readHours((await searchParams).hours);
  const owner = await readOwner();
  let result: Awaited<ReturnType<typeof getPathForOwner>>;
  try {
    result = owner ? await getPathForOwner(id, owner, role, hours) : { ok: false, reason: "not_found" };
  } catch (error) {
    // Database errors carry query parameters. Log only the name and code.
    const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
    console.error("path failed:", error instanceof Error ? error.name : typeof error, code ?? "");
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

      <nav aria-label="Hours a week" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Hours a week:</span>
        {WEEKLY_HOURS.map((h) => (
          <Link
            key={h}
            href={`/resume/${id}/path/${slug}?hours=${h}`}
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
          closes: STATUS_LABEL[s.status],
          doneOn: s.doneAt ? dayMonth.format(new Date(s.doneAt)) : undefined,
          resources: s.resources,
          proofTask: s.proofTask,
          action: <MarkDone stepId={s.id} title={s.skillName} done={Boolean(s.doneAt)} />,
        }))}
      />
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

function TryAgain() {
  return (
    <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
      We couldn&apos;t build your path just now. Please reload the page in a minute.
    </p>
  );
}

export default function PathPage(props: PageProps<"/resume/[id]/path/[slug]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Path" />
      <Suspense fallback={<p className="text-sm text-muted">Building your path…</p>}>
        <Path {...props} />
      </Suspense>
    </div>
  );
}
