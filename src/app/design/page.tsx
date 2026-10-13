import type { Metadata } from "next";
import { CoveredSkills } from "@/components/gaps/covered-skills";
import { GapRating } from "@/components/gaps/gap-rating";
import { JobCheck } from "@/components/gaps/job-check";
import { JobCheckResult } from "@/components/gaps/job-check-result";
import { RolePicker, type RoleOption } from "@/components/gaps/role-picker";
import { ApplyHere } from "@/components/route/apply-here";
import { StandInForm } from "@/components/gaps/stand-in-form";
import { StandInNote, UnknownSkills } from "@/components/gaps/stand-in-note";
import { GapCard } from "@/components/route/gap-card";
import { MarkDone } from "@/components/route/mark-done";
import { PathEnd } from "@/components/route/path-end";
import { PathSteps, type PathStepView } from "@/components/route/path-steps";
import { ProgressRoute } from "@/components/route/progress-route";
import { ReadinessCard } from "@/components/route/readiness-card";
import { SkillCoverageBar } from "@/components/route/skill-coverage-bar";
import { ProfileEditor } from "@/components/resume/profile-editor";
import { LocalTestNotice } from "@/components/resume/local-test-notice";
import { ResumeDownload } from "@/components/resume/resume-download";
import { UploadForm } from "@/components/resume/upload-form";
import { CertificationList } from "@/components/roles/certification-list";
import { DraftNotice } from "@/components/roles/draft-notice";
import { PostingShareBar } from "@/components/roles/posting-share-bar";
import { RoleCard } from "@/components/roles/role-card";
import { RoleSkillList } from "@/components/roles/role-skill-list";
import { SiteHeader } from "@/components/site/site-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { PageNotice } from "@/components/ui/page-notice";
import { ChoiceTag } from "@/components/ui/choice-tag";
import { StatusChip } from "@/components/ui/status-chip";
import { GoalsCard } from "@/components/today/goals-card";
import { AppShell } from "@/components/app/app-shell";
import { PageLoading } from "@/components/app/page-loading";
import { StreakChip } from "@/components/today/streak-chip";
import { CertificateForm } from "@/components/proof/certificate-form";
import { MetroMap } from "@/components/map/metro-map";
import { arrivedRide } from "@/lib/ride/build";
import { exampleLifeLine, exampleMapLine } from "@/lib/map/fixtures";
import { DeparturesView } from "@/components/departures/departures-view";
import { MeView } from "@/components/me/me-view";
import { exampleSettings } from "@/components/settings/fixtures";
import { SettingsView } from "@/components/settings/settings-view";
import { InboxView, VerifiedBadge } from "@/components/inbox/inbox-view";
import { CompanyChat, CompanyMessages } from "@/components/corporate/company-messages";
import { CorporateHome, CorporateStart } from "@/components/corporate/corporate-home";
import {
  exampleApplications,
  exampleBoard,
  exampleCandidate,
  exampleCompanyChat,
  exampleCompanyInterviews,
  exampleCompanyMessages,
  exampleCorporateHome,
  exampleInboxAsk,
  exampleInterviewerCandidate,
  exampleJobFormData,
  examplePostedJob,
  exampleScheduler,
  exampleSignupDetails,
  exampleTimesChat,
} from "@/components/corporate/fixtures";
import { InterviewsTab } from "@/components/corporate/interview-parts";
import { CompanyInterviews, Scheduler } from "@/components/corporate/interviews-screens";
import { ArrivalsView } from "@/components/arrivals/arrivals-view";
import { JobBoard } from "@/components/corporate/job-board";
import { MatchDots, MatchList } from "@/components/corporate/match-parts";
import { JobForm } from "@/components/corporate/job-form";
import { JobStatusBadge, PostedJobCard } from "@/components/corporate/job-parts";
import { JobReport } from "@/components/corporate/job-report";
import { JobsPanel } from "@/components/corporate/jobs-panel";
import { PostedJobs } from "@/components/departures/posted-jobs";
import { roleOptions, skillOptions } from "@/lib/corporate/job-content";
import { OrgSignupForm } from "@/components/corporate/org-signup-form";
import { AntiScamLine, OrgStatusBadge, SecondAdminBanner, TestCodeBox } from "@/components/corporate/parts";
import { AdminCompanyRow, CompanyReview } from "@/components/admin/company-review";
import { exampleReviewCompanies } from "@/components/admin/fixtures";
import { exampleThreads } from "@/lib/inbox/fixtures";
import { exampleMe } from "@/lib/me/fixtures";
import { exampleApplied, exampleJobs, exampleSaved } from "@/lib/departures/fixtures";
import { TodayStatePreview, type TodayData } from "@/components/today/today-preview";
import { RideCard } from "@/components/today/ride-card";
import type { JobCheckView } from "@/lib/jobs/groups";
import type { RoleCertificationView, RoleSkillView, RoleView } from "@/lib/role-view";
import type { Gap, Profile } from "@/lib/schemas";
import {
  exampleDepartures,
  exampleEvents,
  exampleFirstTally,
  exampleFirstTasks,
  exampleGoals,
  exampleName,
  exampleOnYourLine,
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
const exampleJobCheck: JobCheckView = {
  id: "example-check",
  company: "Example Analytics Pvt Ltd",
  title: "Data Analyst",
  createdAt: "2026-10-12T09:30:00.000Z",
  covered: [
    { skillId: "sql", skillName: "SQL", by: "resume" },
    { skillId: "excel", skillName: "Excel", by: "resume" },
    { skillId: "python", skillName: "Python", by: "proof" },
  ],
  alsoGoals: [{ skillId: "statistics", skillName: "Statistics", status: "missing" }],
  onlyThisJob: [
    { skillId: "power-bi", skillName: "Power BI", status: "weak" },
    { skillId: "data-orchestration", skillName: "Data pipeline orchestration", status: "missing" },
  ],
  notAsked: [{ skillId: "data-cleaning", skillName: "Data cleaning" }],
  goodToHave: [
    { skillId: "tableau", skillName: "Tableau", status: "missing" },
    { skillId: "version-control", skillName: "Version control", status: "met" },
  ],
  unknown: ["Alteryx", "SAS"],
};
// "Your choice" goals added from the example check: apart from the line, tagged with their job.
const exampleChoice = { company: exampleJobCheck.company };
const exampleChoiceMapLine = {
  ...exampleMapLine,
  choiceGoals: [
    {
      ...exampleMapLine.goals[exampleMapLine.goals.length - 1],
      goalId: null,
      skillId: "data-orchestration",
      name: "Data pipeline orchestration",
      status: "missing" as const,
      learnDone: false,
      proved: false,
      resources: [],
      practice: null,
      certificates: [],
      choice: exampleChoice,
    },
    {
      ...exampleMapLine.goals[0],
      goalId: null,
      skillId: "tableau",
      name: "Tableau",
      status: "missing" as const,
      proved: true,
      choice: { company: null },
    },
  ],
};
const exampleChoiceGoals = {
  ...exampleGoals,
  choiceGoals: [
    {
      id: "example-choice",
      name: "Data pipeline orchestration",
      status: "missing" as const,
      evidence: `You added this goal for a job at ${exampleJobCheck.company}. It doesn't change your match or your gaps.`,
      quote: null,
      pitstops: [
        { number: 1, kind: "learn" as const, title: "Study Data pipeline orchestration on your own", note: "1 task", state: "ahead" as const },
        { number: 2, kind: "prove" as const, title: "Prove: skill check, certificate or work", note: "meets this goal", state: "ahead" as const },
      ],
      suggestion: null,
      choice: exampleChoice,
    },
  ],
};
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
    closes: "SQL window functions (not on your resume yet)",
    reason: "Analyst roles here rank and compare rows every week, and your resume shows joins but no window functions yet.",
    resources: [
      { title: "Window functions playlist", provider: "YouTube", kind: "video", url: "https://www.youtube.com/" },
      { title: "Advanced SQL", provider: "Kaggle Learn", kind: "course", url: "https://www.kaggle.com/learn/advanced-sql" },
    ],
    proofTask: "rank the top 5 products per month from a sample sales table.",
    action: <MarkDone stepId="demo-2" title="SQL window functions" done={false} demo />,
  },
  { key: "powerbi", title: "One Power BI project", hours: 6, week: 3, closes: "Power BI (weak on your resume)", action: <MarkDone stepId="demo-3" title="Power BI project" done={false} demo /> },
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
  certifications: [{ name: "Google Data Analytics Professional Certificate", earned: null, expires: null }],
};

const exampleRoleSkills: RoleSkillView[] = [
  { skillId: "sql", name: "SQL", expectation: "Joins, grouping and window functions on real tables", postingShare: 0.91, context: false },
  { skillId: "excel", name: "Excel", expectation: "Pivot tables and lookups", postingShare: 0.48, context: false },
  { skillId: "storytelling", name: "Data storytelling", expectation: "Explain a finding to a non-technical manager", postingShare: null, context: false },
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
  events: exampleEvents,
  onYourLine: exampleOnYourLine,
  greeting: "Evening",
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
        <h2 className="text-2xl font-semibold">Page notice</h2>
        <p className="text-sm text-muted">Error and not-found pages. Says what happened and gives a way forward.</p>
        <div className="rounded-lg border border-line bg-surface">
          <PageNotice title="We can't find that page" text="The link may be old, or the page may belong to someone else.">
            <ButtonLink href="/">Go to the home page</ButtonLink>
          </PageNotice>
        </div>
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
        <div className="flex flex-wrap gap-2">
          <ChoiceTag company={null} />
          <ChoiceTag company="Example Analytics Pvt Ltd" />
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
        <p className="text-sm text-muted">Every goal proved: the train is at Match and the ride points to the roles to board.</p>
        <RideCard name={exampleName} greeting="Evening" ride={arrivedRide(10)} week={exampleWeek} />
        <p className="text-sm text-muted">Your goals with a &quot;Your choice&quot; goal, added from a job check: listed apart, its own spur, never moving the train.</p>
        <div className="max-w-xl">
          <GoalsCard summary={exampleChoiceGoals} mapHref="/map" demo />
        </div>
        <p className="text-sm text-muted">Add a certificate: opens from the prove pitstop. Only certificates that prove the goal are listed.</p>
        <div className="max-w-xl">
          <CertificateForm goalId="example" goalName="SQL window functions" certificates={exampleToday.ride.prove?.certificates ?? []} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Map (signed in)</h2>
        <p className="text-sm text-muted">The line drawn from the gaps and the path, and the Life line. Tap a pitstop or moment for its panel. Below it, the map before a resume.</p>
        <MetroMap line={exampleMapLine} life={exampleLifeLine} />
        <MetroMap line={null} />
        <p className="text-sm text-muted">With &quot;Your choice&quot; goals: off the line, listed under the key, each with its tag and Remove from my goals.</p>
        <MetroMap line={exampleChoiceMapLine} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Departures (signed in)</h2>
        <p className="text-sm text-muted">Roles with readiness in words, filters, Saved and Applied, and the detail panel. Below it, the page before a resume.</p>
        <DeparturesView jobs={exampleJobs} initialSaved={exampleSaved} initialApplied={exampleApplied} />
        <DeparturesView jobs={exampleJobs.slice(0, 3)} hasResume={false} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Your profile (signed in)</h2>
        <p className="text-sm text-muted">The person&apos;s own profile with &quot;View as others&quot;, stories on a Board or List with the SMART check.</p>
        <MeView me={exampleMe} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Account settings (signed in)</h2>
        <p className="text-sm text-muted">
          Section list, name with the unsaved-changes bar, the locked email, how the person signs in, download and delete with its DELETE check.
          Example data, so nothing saves.
        </p>
        <div className="rounded-lg border border-line px-4 pt-6">
          <SettingsView data={exampleSettings} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Inbox (signed in)</h2>
        <p className="text-sm text-muted">
          Applications, people and message requests, the open chat with the interview-times picker, and the private availability panel. Example data, so
          nothing sends.
        </p>
        <InboxView threads={exampleThreads} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Corporate (signed in)</h2>
        <p className="text-sm text-muted">
          Company sign-up (handoff 12f): Company, Verify, Company page, Review. Status badges, the test-mode code box, the anti-scam line and the
          second-admin banner. Example data, so nothing sends.
        </p>
        <div className="flex flex-wrap gap-2">
          <OrgStatusBadge status="pending" />
          <OrgStatusBadge status="verified" />
          <OrgStatusBadge status="suspended" />
        </div>
        <TestCodeBox code="042917" />
        <AntiScamLine />
        <SecondAdminBanner daysLeft={12} />
        <SecondAdminBanner daysLeft={0} />
        <div className="rounded-lg border border-line p-4">
          <OrgSignupForm />
        </div>
        <div className="rounded-lg border border-line p-4">
          <OrgSignupForm initial={exampleSignupDetails} startAt={1} />
        </div>
        <p className="text-sm text-muted">Corporate home for a Recruiter admin, with Team and access (people, access waiting for a code, a request).</p>
        <div className="rounded-lg border border-line p-4">
          <CorporateHome view={exampleCorporateHome} />
        </div>
        <p className="text-sm text-muted">Corporate for someone with no company role: set up a company, or confirm a role they were given.</p>
        <div className="rounded-lg border border-line p-4">
          <CorporateStart open />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Company review (admins only)</h2>
        <p className="text-sm text-muted">
          /admin/companies: one row per company waiting for review, suspended, or left with no Recruiter admin. Flags for no admin and a website on
          another domain; Verify, Suspend with a confirm step, and Verify again. Example data, so the buttons are off.
        </p>
        <AdminCompanyRow company={{ ...exampleReviewCompanies[0]!, id: "design-row-verify" }} pending={false} confirming={false} />
        <p className="text-sm text-muted">Suspend asks first.</p>
        <AdminCompanyRow company={{ ...exampleReviewCompanies[1]!, id: "design-row-confirm" }} pending={false} confirming />
        <p className="text-sm text-muted">The whole page, and the list with nothing left to review.</p>
        <div className="rounded-lg border border-line p-4">
          <CompanyReview companies={exampleReviewCompanies} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <CompanyReview companies={[]} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Corporate jobs (signed in)</h2>
        <p className="text-sm text-muted">
          Build step 3: job status badges, the Jobs list with counts (C7), the Post a job form with its Departures preview (C9), and the card candidates
          see on Departures with Report this job. Example data, so nothing saves.
        </p>
        <div className="flex flex-wrap gap-2">
          <JobStatusBadge status="draft" />
          <JobStatusBadge status="open" />
          <JobStatusBadge status="paused" />
          <JobStatusBadge status="closed" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobsPanel jobs={exampleCorporateHome.jobs} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobsPanel jobs={{ counts: { draft: 0, open: 0, paused: 0, closed: 0 }, items: [], canPost: true, blocked: null }} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobForm data={{ ...exampleJobFormData, roles: roleOptions(), skills: skillOptions() }} initial={null} today="2026-10-13" />
        </div>
        <div className="max-w-[560px]">
          <PostedJobCard job={examplePostedJob} report={<JobReport jobId={examplePostedJob.id} title={examplePostedJob.title} />} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <PostedJobs jobs={[examplePostedJob, { ...examplePostedJob, id: "example-job-2", title: "Freelance QA tester", workType: "freelance", city: "Remote", oneOf: [], nice: [] }]} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Applications and the board (signed in)</h2>
        <p className="text-sm text-muted">
          Build step 4: Apply on CareerMetro with its consent on Departures (one card per state: can apply, applied, no resume, signed out), Match to this job in
          words, a job&apos;s six-lane board with the candidate drawer (open a card), and Arrivals. Example data, so nothing saves or moves.
        </p>
        <div className="rounded-lg border border-line p-4">
          <PostedJobs
            jobs={[
              examplePostedJob,
              { ...examplePostedJob, id: "example-job-3", title: "Weekend SOC analyst L1", workType: "part_time" },
              { ...examplePostedJob, id: "example-job-4", title: "Cloud security engineer", city: "Remote" },
              { ...examplePostedJob, id: "example-job-5", title: "Security engineer", city: "Hyderabad" },
            ]}
            states={{
              "example-job": { kind: "can_apply" },
              "example-job-3": { kind: "applied", stage: "shortlisted", withdrawn: false },
              "example-job-4": { kind: "no_resume" },
              "example-job-5": { kind: "signed_out" },
            }}
          />
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-2">
            <MatchDots match={exampleBoard.cards[0].match} />
            <MatchDots match={exampleBoard.cards[2].match} />
          </div>
          <div className="max-w-[520px] flex-1 rounded-lg border border-line p-4">
            <MatchList match={exampleCandidate.match} />
          </div>
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobBoard board={exampleBoard} example={exampleCandidate} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobBoard board={{ ...exampleBoard, canMove: false, assignedOnly: true, cards: [], withdrawn: 0 }} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <ArrivalsView applications={exampleApplications} today="2026-10-12" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <ArrivalsView applications={[]} today="2026-10-12" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Company chats (signed in)</h2>
        <p className="text-sm text-muted">
          Build step 5: Corporate Messages with the list and one application&apos;s chat (shared-with line, anti-scam line, Ask a question), a closed chat, the
          Interviewer&apos;s read-only view, and the candidate&apos;s side in the Inbox with the verified badge. Example data, so nothing sends.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <VerifiedBadge />
        </div>
        <div className="rounded-lg border border-line p-4">
          <CompanyMessages view={exampleCompanyMessages} chat={exampleCompanyChat} />
        </div>
        <div className="max-w-[720px]">
          <CompanyChat chat={{ ...exampleCompanyChat, applicationId: "a4", state: "closed" }} company="Example Labs" />
        </div>
        <div className="max-w-[720px]">
          <CompanyChat chat={{ ...exampleCompanyChat, applicationId: "a5", state: "suspended" }} company="Example Labs" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <CompanyMessages view={{ ...exampleCompanyMessages, role: "interviewer", items: [] }} chat={null} />
        </div>
        <InboxView threads={exampleThreads.filter((t) => t.kind === "application")} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Interviews (signed in)</h2>
        <p className="text-sm text-muted">
          Build step 6: Ask for times in a chat and the times offered, the candidate&apos;s slot picker in the Inbox, the drawer&apos;s Interviews tab for the job team
          and for an Interviewer (feedback form), Corporate Interviews, the scheduler (offered times, length, interviewers with busy times), and Arrivals with Next up,
          the 10-day strip and Accept or Decline (see the Arrivals examples above). Example data, so nothing changes.
        </p>
        <div className="max-w-[720px]">
          <CompanyChat chat={exampleTimesChat} company="Example Labs" />
        </div>
        <InboxView
          threads={exampleThreads
            .filter((t) => t.kind === "application")
            .slice(0, 1)
            .map((t) => ({ ...t, messages: [...t.messages.filter((m) => m.type !== "times"), exampleInboxAsk] }))}
        />
        <div className="grid gap-4 min-[900px]:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <InterviewsTab applicationId="a1" data={exampleCandidate.interviews} />
          </div>
          <div className="rounded-lg border border-line p-4">
            <InterviewsTab applicationId="a1" data={exampleInterviewerCandidate.interviews} />
          </div>
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobBoard board={exampleBoard} example={exampleCandidate} startTab="interviews" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <CompanyInterviews view={exampleCompanyInterviews} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <Scheduler view={exampleScheduler} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <Scheduler view={{ ...exampleScheduler, slots: [], days: [], interviews: [], teamWeek: [], waitingForTimes: true, refusal: "Your company can't arrange interviews until CareerMetro has verified it." }} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">App shell (signed in)</h2>
        <p className="text-sm text-muted">Top bar on desktop, tab bar under 760 px, avatar menu (Admin shows only for admins). Sections not built yet show as Soon.</p>
        <div className="h-96 rounded-lg border border-line">
          <AppShell embedded user={{ name: "Priya Nair", initials: "PN", streakDays: 11, todayCounted: false, showStreak: true, canSignOut: false, inboxUnread: 2, isAdmin: true }}>
            <p className="text-sm text-muted">Page content goes here.</p>
          </AppShell>
        </div>
        <p className="text-sm text-muted">While a screen loads: the frame with an empty avatar and quiet blocks, never a blank page.</p>
        <div className="h-96 overflow-hidden rounded-lg border border-line">
          <AppShell embedded user={null}>
            <PageLoading />
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
          {/* "Asked in N of 10 postings" only where the role was measured on postings; the last example has no data. */}
          {exampleGaps.map((g, i) => (
            <GapCard key={g.skillId} gap={g} askedIn={["Asked in 7 of 10 postings", "Asked in fewer than 1 of 10 postings"][i] ?? null} />
          ))}
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-xl font-semibold">Your path</h2>
          <ProgressRoute current="Path" />
          <PathSteps steps={exampleSteps} />
          <PathEnd next={{ kind: "waitlist" }} />
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
          <RolePicker
            resumeId="example"
            roles={exampleRoleOptions}
            suggestions={[
              { slug: "full-stack-developer", title: "Full Stack Developer (MERN)", experience: "1 to 5 years", met: 5, total: 10, shown: ["JavaScript", "Node.js", "SQL"], fits: true },
              { slug: "senior-backend-engineer", title: "Senior Backend Engineer", experience: "5 to 10 years", met: 4, total: 9, shown: ["Node.js", "SQL"], fits: false },
            ]}
            standIns={[{ id: "example-stand-in", title: "Supply Chain Analyst", company: "Example Freight Pvt Ltd" }]}
            demo
          />
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
          <CoveredSkills title="Good to have" skills={[{ skillId: "python", skillName: "Python", status: "missing" }]} />
          <GapRating analysisId="example" initial={null} demo />
        </div>
      </section>
      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Job check form</h2>
          <JobCheck resumeId="example" roleSlug="data-analyst" roleTitle="Data Analyst" checks={[]} goals={{ skills: [], here: "/design" }} demo />
          <h2 className="text-2xl font-semibold">To apply here (Path page)</h2>
          <p className="text-sm text-muted">&quot;Plan for this job&quot; opens the path with this section on top. The path below it stays as it is.</p>
          <ApplyHere
            checkId={exampleJobCheck.id}
            company={exampleJobCheck.company}
            title={exampleJobCheck.title}
            alsoGoals={exampleJobCheck.alsoGoals}
            onlyThisJob={exampleJobCheck.onlyThisJob}
            goals={{ skills: ["power-bi"], here: "/design" }}
            demo
          />
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Job check result</h2>
          <p className="text-sm text-muted">Signed in: Power BI is a Your choice goal already, so it can be removed; the other skill can be added.</p>
          <JobCheckResult check={exampleJobCheck} roleTitle="Data Analyst" planHref="/design" goals={{ skills: ["power-bi"], chosen: { "power-bi": "example-goal" }, here: "/design" }} demo />
          <p className="text-sm text-muted">Not signed in: goals are kept for an account.</p>
          <JobCheckResult
            check={{ ...exampleJobCheck, id: "example-anonymous", alsoGoals: [], notAsked: [], covered: [], goodToHave: [], unknown: [] }}
            roleTitle="Data Analyst"
            planHref="/design"
            goals={{ skills: null, here: "/design" }}
            demo
          />
          <JobCheckResult
            check={{ ...exampleJobCheck, id: "example-empty", company: "Sample Retail LLP", title: "MIS Executive", covered: [], alsoGoals: [], onlyThisJob: [], goodToHave: [], unknown: ["Tally"] }}
            roleTitle="Data Analyst"
            planHref="/design"
            goals={{ skills: [], here: "/design" }}
            demo
          />
        </div>
      </section>
      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">My role isn&apos;t listed</h2>
          <StandInForm resumeId="example" initialTitle="Supply Chain Analyst" demo />
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">A job standing in for the role</h2>
          <StandInNote title="Supply Chain Analyst" />
          <ReadinessCard
            readiness={{
              headline: "You cover 2 of the 5 skills this job asks for.",
              explanation: "As a rough estimate, about 28 hours of focused work gets you ready to prove the rest.",
              estimatedHours: 28,
            }}
          />
          <GapCard
            gap={{
              skillId: "statistics",
              skillName: "Statistics",
              status: "missing",
              resumeQuote: null,
              requirement: "Asked for in this job posting",
              explanation: "This job posting asks for Statistics.",
            }}
          />
          <UnknownSkills names={["Demand forecasting", "SAP MM"]} />
        </div>
      </section>
      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Resume upload</h2>
          <p className="text-sm text-muted">Local test notice: shown only while the stand-in Claude API is in use, never on production.</p>
          <LocalTestNotice demo />
          <UploadForm demo />
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Resume check</h2>
          <ProfileEditor resumeId="example" initial={exampleProfile} demo />
          <p className="text-sm text-muted">Shown above the check once the resume is confirmed.</p>
          <ResumeDownload resumeId="example" named={false} demo />
        </div>
      </section>
      <p className="font-mono text-xs text-muted">All names, numbers and dates on this page are examples.</p>
    </div>
  );
}
