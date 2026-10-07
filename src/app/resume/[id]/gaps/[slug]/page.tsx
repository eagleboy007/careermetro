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
import { roleProfiles, skills } from "@/content";
import { getGapsForSession } from "@/lib/gaps/store";
import { readSessionId } from "@/lib/session";

export const metadata: Metadata = { title: "Your gaps · CareerMetro", robots: { index: false } };

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

async function Gaps({ params }: { params: Promise<{ id: string; slug: string }> }) {
  // Per-request data: the resume lookup reads the clock and the session cookie.
  await connection();
  const { id, slug } = await params;
  const role = roleProfiles.find((r) => r.slug === slug);
  if (!role) notFound();
  const sessionId = await readSessionId();
  const result = sessionId ? await getGapsForSession(id, sessionId, role) : ({ ok: false, reason: "not_found" } as const);
  if (!result.ok && result.reason === "not_found") return <ResumeNotFound />;
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
            {analysis.gaps.length === 1 ? "The gap to close" : `The ${analysis.gaps.length} gaps that matter most`}
          </h2>
          {analysis.gaps.map((g) => (
            <GapCard key={g.skillId} gap={g} />
          ))}
          <p className="text-xs text-muted">Ordered by how often employers ask for each skill. Hours are a rough estimate.</p>
        </section>
      ) : null}
      <CoveredSkills title="Skills your resume already shows" skills={met} />
      <CoveredSkills title="Nice to have" skills={analysis.niceToHave} />
      <GapRating analysisId={analysisId} initial={rating} />
      <p className="text-sm text-muted">
        <Link href={`/resume/${id}/role`} className="underline underline-offset-2 hover:text-ink">
          Pick another role
        </Link>
        {" · "}Your learning path for these gaps is the next step we&apos;re building.
      </p>
    </div>
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
