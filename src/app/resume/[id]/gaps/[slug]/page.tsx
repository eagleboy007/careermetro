import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CoveredSkills } from "@/components/gaps/covered-skills";
import { GapRating } from "@/components/gaps/gap-rating";
import { JobCheck } from "@/components/gaps/job-check";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { ScreeningCheck } from "@/components/resume/screening-check";
import { GapCard } from "@/components/route/gap-card";
import { ProgressRoute } from "@/components/route/progress-route";
import { ReadinessCard } from "@/components/route/readiness-card";
import { SiteHeader } from "@/components/site/site-header";
import { ButtonLink } from "@/components/ui/button";
import { roleProfiles, skills } from "@/content";
import { SHOWN_GAPS } from "@/lib/gaps/analysis";
import { askedInForGap, postingShares } from "@/lib/gaps/asked-in";
import { getGapsForOwner } from "@/lib/gaps/store";
import type { JobCheckView } from "@/lib/jobs/groups";
import { goalSkillsOf, jobChecksForPage } from "@/lib/jobs/store";
import { screeningForPage } from "@/lib/resume/screening-store";
import type { ScreeningView } from "@/lib/schemas";
import { readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

export const metadata: Metadata = { title: "Your gaps · CareerMetro", robots: { index: false } };

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

async function Gaps({ params }: { params: Promise<{ id: string; slug: string }> }) {
  // Per-request data: the resume lookup reads the clock and the session cookie.
  await connection();
  const { id, slug } = await params;
  const role = roleProfiles.find((r) => r.slug === slug);
  if (!role) notFound();
  const owner = await readOwner();
  let result: Awaited<ReturnType<typeof getGapsForOwner>>;
  try {
    result = owner ? await getGapsForOwner(id, owner, role) : { ok: false, reason: "not_found" };
  } catch (error) {
    // Database errors carry query parameters, which can hold resume quotes; errorFields keeps only the name and code.
    logEvent("error", "gaps_failed", { route: "/resume/[id]/gaps/[slug]", role: slug, ...errorFields(error) });
    return <TryAgain />;
  }
  if (!result.ok && result.reason === "not_found") return <ResumeNotFound />;
  if (!result.ok && result.reason === "busy") return <TryAgain />;
  if (!result.ok) {
    return (
      <p className="rounded-lg border border-line bg-surface p-5 text-sm">
        First check your resume and press <strong>Looks right</strong>.{" "}
        <Link href={`/resume/${id}`} className="font-medium underline underline-offset-2">
          Check your resume
        </Link>
      </p>
    );
  }

  const { analysis, analysisId, rating } = result;
  // Saved job checks are read-only here; a failure to load them never hides the gaps.
  let checks: JobCheckView[] | null;
  // The account's goal skills, for "Add as my goal"; null for an anonymous visitor, who is asked to sign in.
  let goalSkills: Awaited<ReturnType<typeof goalSkillsOf>> | null = null;
  try {
    [checks, goalSkills] = await Promise.all([
      owner ? jobChecksForPage(id, owner, role.slug, analysis) : [],
      owner?.userId !== undefined ? goalSkillsOf(owner.userId) : null,
    ]);
  } catch (error) {
    logEvent("error", "job_checks_failed", { route: "/resume/[id]/gaps/[slug]", role: slug, ...errorFields(error) });
    checks = null;
  }
  // The screening check (FR-34) is extra: a failure to work it out never hides the gaps.
  let screening: ScreeningView | null = null;
  try {
    screening = owner ? await screeningForPage(id, owner, { role }) : null;
  } catch (error) {
    logEvent("error", "screening_failed", { route: "/resume/[id]/gaps/[slug]", role: slug, ...errorFields(error) });
  }
  // Five gaps up front (the handoff's Gaps screen); every other required gap is stored (each is a goal) and one tap away.
  const top = analysis.gaps.slice(0, SHOWN_GAPS);
  const rest = analysis.gaps.slice(SHOWN_GAPS);
  // "Asked in N of 10 postings" only where this role was measured on postings; otherwise nothing, never a guess.
  const shares = postingShares(role);
  const met = analysis.metSkillIds.map((skillId) => ({ skillId, skillName: skillNames.get(skillId) ?? skillId, status: "met" as const }));
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">{role.title}</p>
        <h1 className="text-4xl font-semibold leading-[1.05]">Your gaps</h1>
      </section>
      <ReadinessCard readiness={analysis.readiness} />
      {analysis.gaps.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Your gaps">
          <h2 className="font-sans text-lg font-semibold tracking-normal">
            {top.length === 1 ? "The gap to close" : `The ${top.length} gaps that matter most`}
          </h2>
          {top.map((g) => (
            <GapCard key={g.skillId} gap={g} askedIn={askedInForGap(g, shares)} />
          ))}
          {rest.length > 0 && (
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                {rest.length === 1 ? "1 more gap" : `${rest.length} more gaps`}
                <ChevronDown
                  size={18}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {rest.map((g) => (
                  <GapCard key={g.skillId} gap={g} askedIn={askedInForGap(g, shares)} />
                ))}
              </div>
            </details>
          )}
          <p className="text-xs text-muted">Ordered by how often employers ask for each skill. Hours are a rough estimate.</p>
        </section>
      ) : null}
      <CoveredSkills title="Skills your resume already shows" skills={met} />
      <CoveredSkills title="Good to have" skills={analysis.niceToHave} />
      {analysis.gaps.length > 0 && (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="font-semibold">Work on these gaps step by step</p>
          <p className="text-sm text-muted">A short plan with free resources and a small task to prove each skill, sized to your week.</p>
          <ButtonLink href={`/resume/${id}/path/${role.slug}`}>Build my path</ButtonLink>
        </section>
      )}
      {screening && <ScreeningCheck view={screening} resumeId={id} />}
      <JobCheck
        resumeId={id}
        profileVersion={screening?.profileVersion ?? null}
        roleSlug={role.slug}
        roleTitle={role.title}
        checks={checks ?? []}
        goals={{ skills: goalSkills?.skills ?? null, chosen: goalSkills?.chosen, here: `/resume/${id}/gaps/${role.slug}` }}
      />
      {checks === null && (
        <p role="alert" className="rounded-lg border border-line bg-surface p-4 text-sm">
          We couldn&apos;t load your saved job checks just now. Please reload the page in a minute.
        </p>
      )}
      <GapRating analysisId={analysisId} initial={rating} />
      <p className="text-sm text-muted">
        <Link href={`/resume/${id}/role`} className="underline underline-offset-2 hover:text-ink">
          Pick another role
        </Link>
      </p>
    </div>
  );
}

function TryAgain() {
  return (
    <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
      We couldn&apos;t work out your gaps just now. Please reload the page in a minute.
    </p>
  );
}

export default function GapsPage({ params }: PageProps<"/resume/[id]/gaps/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Gaps" />
      <Suspense fallback={<p className="text-sm text-muted">Comparing your resume with the role…</p>}>
        <Gaps params={params} />
      </Suspense>
    </main>
  );
}
