import type { Metadata } from "next";
import { CoveredSkills } from "@/components/gaps/covered-skills";
import { GapRating } from "@/components/gaps/gap-rating";
import { RolePicker, type RoleOption } from "@/components/gaps/role-picker";
import { GapCard } from "@/components/route/gap-card";
import { MarkDone } from "@/components/route/mark-done";
import { PathSteps, type PathStepView } from "@/components/route/path-steps";
import { ProgressRoute } from "@/components/route/progress-route";
import { ReadinessCard } from "@/components/route/readiness-card";
import { SkillCoverageBar } from "@/components/route/skill-coverage-bar";
import { ProfileEditor } from "@/components/resume/profile-editor";
import { UploadForm } from "@/components/resume/upload-form";
import { CertificationList } from "@/components/roles/certification-list";
import { DraftNotice } from "@/components/roles/draft-notice";
import { PostingShareBar } from "@/components/roles/posting-share-bar";
import { RoleCard } from "@/components/roles/role-card";
import { RoleSkillList } from "@/components/roles/role-skill-list";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { StatusChip } from "@/components/ui/status-chip";
import { AppShell } from "@/components/app/app-shell";
import { StreakChip } from "@/components/today/streak-chip";
import { TodayStatePreview, type TodayData } from "@/components/today/today-preview";
import type { RoleCertificationView, RoleSkillView, RoleView } from "@/lib/role-view";
import type { Gap, Profile } from "@/lib/schemas";
import {
  exampleDepartures,
  exampleFirstTally,
  exampleFirstTasks,
  exampleGoals,
  exampleName,
  exampleRide,
  exampleSignalCheck,
  exampleRole as exampleTargetRole,
  exampleWeek,
} from "@/lib/today/fixtures";

export const metadata: Metadata = { title: "Design system · CareerMetro", robots: { index: false } };

// Example data only: shows every component in a realistic state.
const exampleRoleOptions: RoleOption[] = [
  { slug: "data-analyst", title: "Data Analyst", experience: "Up to 3 years", topSkills: ["SQL", "Excel", "Power BI"] },
  { slug: "business-analyst", title: "Business Analyst", experience: "1 to 5 years", topSkills: ["Requirements gathering", "SQL", "Agile and Scrum"] },
];
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
  { key: "pandas", title: "Refresh pandas basics", hours: 4, week: 1, doneOn: "3 Oct", action: <MarkDone stepId="demo-1" title="pandas basics" done demo /> },
  {
    key: "sql",
    title: "SQL window functions",
    hours: 6,
    week: 1,
    closes: "Missing gap",
    reason: "Analyst roles here rank and compare rows every week, and your resume shows joins but no window functions yet.",
    resources: [
      { title: "Window functions playlist", provider: "YouTube", kind: "video", url: "https://www.youtube.com/" },
      { title: "Advanced SQL", provider: "Kaggle Learn", kind: "course", url: "https://www.kaggle.com/learn/advanced-sql" },
    ],
    proofTask: "rank the top 5 products per month from a sample sales table.",
    action: <MarkDone stepId="demo-2" title="SQL window functions" done={false} demo />,
  },
  { key: "powerbi", title: "One Power BI project", hours: 6, week: 3, closes: "Weak evidence", action: <MarkDone stepId="demo-3" title="Power BI project" done={false} demo /> },
];

const exampleProfile: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [
    {
      title: "Data Analyst",
      employer: "Example Retail Pvt Ltd",
      start: "2022-06",
      end: null,
      highlights: ["Wrote SQL queries for weekly sales reports across 40 stores"],
    },
  ],
  skills: [
    { name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] },
    { name: "Power BI", lastUsed: null, evidence: [] },
  ],
  education: [{ qualification: "B.Com", institution: "Example University", year: "2021" }],
  certifications: ["Google Data Analytics Professional Certificate"],
};

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

const exampleToday: TodayData = {
  name: exampleName,
  role: exampleTargetRole,
  ride: exampleRide,
  week: exampleWeek,
  departures: exampleDepartures,
  goals: exampleGoals,
  tally: exampleFirstTally,
  firstTasks: exampleFirstTasks,
  lineHours: 46,
  signalCheck: exampleSignalCheck,
};

const colors = ["accent", "ink", "muted", "surface-2", "accent-soft", "bad", "warn", "good", "board", "board-ink", "board-dim", "board-line"] as const;

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

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Today (signed in)</h2>
        <p className="text-sm text-muted">The signed-in home for each user state. Switch states to see each one.</p>
        <div className="flex flex-wrap items-center gap-3">
          <StreakChip days={0} todayCounted={false} />
          <StreakChip days={11} todayCounted={false} />
          <StreakChip days={12} todayCounted />
        </div>
        <TodayStatePreview data={exampleToday} upload={<UploadForm demo />} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">App shell (signed in)</h2>
        <p className="text-sm text-muted">Top bar on desktop, tab bar under 760 px, avatar menu. Sections not built yet show as Soon.</p>
        <div className="h-96 rounded-lg border border-line">
          <AppShell embedded user={{ name: "Priya Nair", initials: "PN", streakDays: 11, todayCounted: false, showStreak: true, canSignOut: false }}>
            <p className="text-sm text-muted">Page content goes here.</p>
          </AppShell>
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
          <PathSteps steps={exampleSteps} />
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
      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Role picker</h2>
          <RolePicker resumeId="example" roles={exampleRoleOptions} demo />
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Covered skills and rating</h2>
          <CoveredSkills
            title="Skills your resume already shows"
            open
            skills={[
              { skillId: "sql", skillName: "SQL", status: "met" },
              { skillId: "excel", skillName: "Excel", status: "met" },
            ]}
          />
          <CoveredSkills title="Nice to have" skills={[{ skillId: "python", skillName: "Python", status: "missing" }]} />
          <GapRating analysisId="example" initial={null} demo />
        </div>
      </section>
      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Resume upload</h2>
          <UploadForm demo />
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Resume check</h2>
          <ProfileEditor resumeId="example" initial={exampleProfile} demo />
        </div>
      </section>
      <p className="font-mono text-xs text-muted">All names, numbers and dates on this page are examples.</p>
    </div>
  );
}
