import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CoveredSkills } from "@/components/gaps/covered-skills";
import { GapRating } from "@/components/gaps/gap-rating";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { GapCard } from "@/components/route/gap-card";
import { ProgressRoute } from "@/components/route/progress-route";
import { ReadinessCard } from "@/components/route/readiness-card";
import { SiteHeader } from "@/components/site/site-header";
import { ButtonLink } from "@/components/ui/button";
import { roleProfiles, skills } from "@/content";
import { SHOWN_GAPS } from "@/lib/gaps/analysis";
import { getGapsForOwner } from "@/lib/gaps/store";
import { readOwner } from "@/lib/session";

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
    // Database errors carry query parameters, which can hold resume quotes. Log only the name and code.
    const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
    console.error("gap analysis failed:", error instanceof Error ? error.name : typeof error, code ?? "");
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
  // FR-11: five gaps up front; every other required gap is stored (each is a goal) and one tap away.
  const top = analysis.gaps.slice(0, SHOWN_GAPS);
  const rest = analysis.gaps.slice(SHOWN_GAPS);
  const met = analysis.metSkillIds.map((skillId) => ({ skillId, skillName: skillNames.get(skillId) ?? skillId, status: "met" as const }));
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-xs uppercase tracking-wider text-muted">{role.title}</p>
        <h1 className="text-4xl font-semibold leading-[1.05]">Your gaps</h1>
      </section>
      <ReadinessCard readiness={analysis.readiness} />
      {analysis.gaps.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Top gaps">
          <h2 className="font-sans text-lg font-semibold tracking-normal">
            {top.length === 1 ? "The gap to close" : `The ${top.length} gaps that matter most`}
          </h2>
          {top.map((g) => (
            <GapCard key={g.skillId} gap={g} />
          ))}
          {rest.length > 0 && (
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer list-none p-4 text-sm font-semibold marker:hidden">
                {rest.length === 1 ? "1 more required skill" : `${rest.length} more required skills`}
                <span className="ml-2 font-normal text-muted group-open:hidden">Show</span>
                <span className="ml-2 hidden font-normal text-muted group-open:inline">Hide</span>
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {rest.map((g) => (
                  <GapCard key={g.skillId} gap={g} />
                ))}
              </div>
            </details>
          )}
          <p className="text-xs text-muted">Ordered by how often employers ask for each skill. Hours are a rough estimate.</p>
        </section>
      ) : null}
      <CoveredSkills title="Skills your resume already shows" skills={met} />
      <CoveredSkills title="Nice to have" skills={analysis.niceToHave} />
      {analysis.gaps.length > 0 && (
        <section className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="font-semibold">Close these gaps step by step</p>
          <p className="text-sm text-muted">A short plan with free resources and a small task to prove each skill, sized to your week.</p>
          <ButtonLink href={`/resume/${id}/path/${role.slug}`}>Build my path</ButtonLink>
        </section>
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Gaps" />
      <Suspense fallback={<p className="text-sm text-muted">Comparing your resume with the role…</p>}>
        <Gaps params={params} />
      </Suspense>
    </div>
  );
}
