import type { Metadata } from "next";
import { GapCard } from "@/components/route/gap-card";
import { PathSteps, type PathStepView } from "@/components/route/path-steps";
import { ProgressRoute } from "@/components/route/progress-route";
import { ReadinessCard } from "@/components/route/readiness-card";
import { SkillCoverageBar } from "@/components/route/skill-coverage-bar";
import { CertificationList } from "@/components/roles/certification-list";
import { DraftNotice } from "@/components/roles/draft-notice";
import { PostingShareBar } from "@/components/roles/posting-share-bar";
import { RoleCard } from "@/components/roles/role-card";
import { RoleSkillList } from "@/components/roles/role-skill-list";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { StatusChip } from "@/components/ui/status-chip";
import type { RoleCertificationView, RoleSkillView, RoleView } from "@/lib/role-view";
import type { Gap } from "@/lib/schemas";

export const metadata: Metadata = { title: "Design system · CareerMetro", robots: { index: false } };

// Example data only: shows every component in a realistic state.
const exampleGaps: Gap[] = [
  {
    skillId: "sql-window-functions",
    skillName: "SQL window functions",
    status: "missing",
    resumeQuote: "Wrote SQL queries for weekly sales reports",
    requirement: "Window functions and CTEs",
    explanation: "The role asks for window functions and CTEs.",
  },
  {
    skillId: "power-bi",
    skillName: "Power BI dashboards",
    status: "weak",
    resumeQuote: null,
    requirement: "Build and publish dashboards",
    explanation: "Listed under skills, but no project or result shows it.",
  },
  {
    skillId: "pandas",
    skillName: "Python (pandas)",
    status: "outdated",
    resumeQuote: null,
    requirement: "Recent hands-on use",
    explanation: "Last used in your 2021 role. Most listings ask for recent use.",
  },
];

const exampleSteps: PathStepView[] = [
  { title: "Refresh pandas basics", hours: 4, doneOn: "3 Oct" },
  {
    title: "SQL window functions",
    hours: 6,
    closes: "Missing gap",
    resources: [
      { title: "Window functions playlist", provider: "YouTube", kind: "video", url: "https://www.youtube.com/" },
      { title: "Advanced SQL", provider: "Kaggle Learn", kind: "course", url: "https://www.kaggle.com/learn/advanced-sql" },
    ],
    proofTask: "rank the top 5 products per month from a sample sales table.",
  },
  { title: "One Power BI project", hours: 6, closes: "Weak evidence" },
  { title: "Add both projects to your resume", hours: 3 },
];

const exampleRoleSkills: RoleSkillView[] = [
  { skillId: "sql", name: "SQL", expectation: "Joins, grouping and window functions on real tables", postingShare: 0.91 },
  { skillId: "excel", name: "Excel", expectation: "Pivot tables and lookups", postingShare: 0.48 },
  { skillId: "storytelling", name: "Data storytelling", expectation: "Explain a finding to a non-technical manager", postingShare: null },
];

const exampleCerts: RoleCertificationView[] = [
  {
    id: "pl-300",
    name: "Power BI Data Analyst Associate (PL-300)",
    issuer: "Microsoft",
    level: "associate",
    cost: "paid",
    importance: "recommended",
    why: "Widely named in Indian analyst postings.",
  },
  {
    id: "google-data-analytics",
    name: "Google Data Analytics Certificate",
    issuer: "Google",
    level: "entry",
    cost: "free",
    importance: "optional",
    why: "A structured start if you are new to data.",
  },
];

const exampleRole: RoleView = {
  slug: "data-analyst",
  title: "Data Analyst",
  experience: "Up to 3 years",
  required: exampleRoleSkills,
  niceToHave: [],
  certifications: exampleCerts,
  postingsAnalysed: 120,
  sources: [{ description: "Example source", url: null }],
  reviewed: false,
  updatedOn: "2026-10-06",
};

const colors = ["accent", "ink", "muted", "surface-2", "accent-soft", "bad", "warn", "good"] as const;

export default function DesignPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-10">
      <header className="flex items-center justify-between border-b border-line pb-5">
        <Logo />
        <span className="font-mono text-xs uppercase tracking-wider text-muted">Design system</span>
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Site header</h2>
        <SiteHeader />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Color</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {colors.map((c) => (
            <div key={c} className="flex flex-col gap-1.5 text-sm">
              <span className="h-12 rounded-sm border border-line" style={{ background: `var(--${c})` }} />
              <code className="font-mono text-xs text-muted">{c}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Parts</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Upload resume</Button>
          <Button variant="ghost">Paste a job description</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusChip status="missing" />
          <StatusChip status="weak" />
          <StatusChip status="outdated" />
          <StatusChip status="met" />
        </div>
        <div className="max-w-md">
          <ProgressRoute current="Path" />
        </div>
      </section>

      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-xl font-semibold">Your gaps</h2>
          <ProgressRoute current="Gaps" />
          <ReadinessCard
            readiness={{
              headline: "You're close: 3 gaps to close",
              explanation: "About 4 weeks at 5 hours a week. You already meet 7 of the 10 core skills.",
              estimatedHours: 19,
            }}
          />
          {exampleGaps.map((g) => (
            <GapCard key={g.skillId} gap={g} />
          ))}
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-xl font-semibold">Your path</h2>
          <ProgressRoute current="Path" />
          <PathSteps steps={exampleSteps} currentIndex={1} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Team coverage</h2>
        <div className="grid max-w-xl gap-3">
          <SkillCoverageBar met={3} total={14} />
          <SkillCoverageBar met={9} total={14} />
          <SkillCoverageBar met={11} total={14} />
        </div>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Roles</h2>
        <DraftNotice />
        <div className="grid gap-4 sm:grid-cols-2">
          <RoleCard role={exampleRole} />
        </div>
        <div className="grid max-w-md gap-3">
          <PostingShareBar share={0.91} />
          <PostingShareBar share={0.2} />
          <PostingShareBar share={null} />
        </div>
        <RoleSkillList skills={exampleRoleSkills} />
        <CertificationList certifications={exampleCerts} />
        <CertificationList certifications={[]} />
      </section>
      <p className="font-mono text-xs text-muted">All names, numbers and dates on this page are examples.</p>
    </div>
  );
}
