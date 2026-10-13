import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CoveredSkills } from "@/components/gaps/covered-skills";
import { StandInNote, UnknownSkills } from "@/components/gaps/stand-in-note";
import { GapCard } from "@/components/route/gap-card";
import { ProgressRoute } from "@/components/route/progress-route";
import { ReadinessCard } from "@/components/route/readiness-card";
import { SiteHeader } from "@/components/site/site-header";
import { ButtonLink } from "@/components/ui/button";
import { SHOWN_GAPS } from "@/lib/gaps/analysis";
import { standInForPage } from "@/lib/jobs/store";
import { errorFields, logEvent } from "@/lib/log";
import { readOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Your gaps for this job · CareerMetro", robots: { index: false } };

/**
 * The Gaps page for a job check standing in as the target when our library doesn't have the role
 * (role-suggest-plan.md part B, point 4). The posting's required skills are the gaps, decided by the matcher; nothing
 * here becomes a goal, a path or a match.
 */
async function StandInGaps({ params }: { params: Promise<{ id: string; checkId: string }> }) {
  // Per-request data: the resume lookup reads the clock and the session cookie.
  await connection();
  const { id, checkId } = await params;
  const owner = await readOwner();
  let view: Awaited<ReturnType<typeof standInForPage>>;
  try {
    view = owner ? await standInForPage(id, checkId, owner) : null;
  } catch (error) {
    logEvent("error", "stand_in_failed", { route: "/resume/[id]/job/[checkId]", ...errorFields(error) });
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t work out your gaps for this job just now. Please reload the page in a minute.
      </p>
    );
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <p className="font-semibold">We couldn&apos;t find this job check.</p>
        <p className="text-sm text-muted">
          Checks made without an account are deleted with their resume after 24 hours, and can only be opened in the browser that made them.
        </p>
        <Link href={`/resume/${id}/role`} className="text-sm font-medium underline underline-offset-2">
          Pick a role
        </Link>
      </div>
    );
  }

  const top = view.gaps.slice(0, SHOWN_GAPS);
  const rest = view.gaps.slice(SHOWN_GAPS);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <p className="break-words font-mono text-xs uppercase tracking-wider text-muted">
          {view.title} at {view.company}
        </p>
        <h1 className="text-4xl font-semibold leading-[1.05]">Your gaps for this job</h1>
      </section>
      <StandInNote title={view.title} />
      <ReadinessCard readiness={view.readiness} />
      {view.gaps.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Your gaps">
          <h2 className="font-sans text-lg font-semibold tracking-normal">
            {top.length === 1 ? "The gap to close" : `The ${top.length} gaps that matter most`}
          </h2>
          {top.map((g) => (
            <GapCard key={g.skillId} gap={g} />
          ))}
          {rest.length > 0 && (
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                {rest.length === 1 ? "1 more gap" : `${rest.length} more gaps`}
                <ChevronDown size={18} strokeWidth={1.75} className="shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {rest.map((g) => (
                  <GapCard key={g.skillId} gap={g} />
                ))}
              </div>
            </details>
          )}
          <p className="text-xs text-muted">In the order of the posting, missing skills first. Hours are a rough estimate.</p>
        </section>
      )}
      <CoveredSkills title="Skills your resume already shows" skills={view.met} />
      <CoveredSkills title="Good to have" skills={view.goodToHave} />
      <UnknownSkills names={view.unknown} />
      <section className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4">
        <p className="font-semibold">Found a role from our list that fits?</p>
        <p className="text-sm text-muted">A role from our list gives you goals and a short path with free resources.</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={`/resume/${id}/role`}>Pick a role</ButtonLink>
          <ButtonLink href={`/resume/${id}/role/other`} variant="ghost">
            Check another job
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

export default function StandInGapsPage({ params }: PageProps<"/resume/[id]/job/[checkId]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Gaps" />
      <Suspense fallback={<p className="text-sm text-muted">Comparing your resume with the job…</p>}>
        <StandInGaps params={params} />
      </Suspense>
    </main>
  );
}
