import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { designGalleryEnabled } from "@/lib/preview";
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
import { ScreeningCheck } from "@/components/resume/screening-check";
import {
  exampleScreeningDocx,
  exampleScreeningOld,
  exampleScreeningPasted,
  exampleScreeningPdf,
  exampleScreeningReady,
} from "@/lib/resume/screening-fixtures";
import { UploadForm } from "@/components/resume/upload-form";
import { CertificationList } from "@/components/roles/certification-list";
import { DraftNotice } from "@/components/roles/draft-notice";
import { PostingShareBar } from "@/components/roles/posting-share-bar";
import { RoleCard } from "@/components/roles/role-card";
import { RoleSkillList } from "@/components/roles/role-skill-list";
import { SiteHeader } from "@/components/site/site-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { OFFLINE_NOTICE, PageNotice } from "@/components/ui/page-notice";
import { ChoiceTag } from "@/components/ui/choice-tag";
import { SampleLineNote, SampleResumeNote, SampleTag } from "@/components/ui/sample-tag";
import { StatusChip } from "@/components/ui/status-chip";
import { GoalsCard } from "@/components/today/goals-card";
import { TrackPanel } from "@/components/today/track-picker";
import { AppShell } from "@/components/app/app-shell";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { exampleNotifications } from "@/lib/notifications/fixtures";
import { PageLoading } from "@/components/app/page-loading";
import { StreakChip } from "@/components/today/streak-chip";
import { CertificateForm } from "@/components/proof/certificate-form";
import { ProfileCertifications } from "@/components/me/certifications";
import { MetroMap } from "@/components/map/metro-map";
import { arrivedRide } from "@/lib/ride/build";
import { exampleLifeLine, exampleLifeLineNoInterests, exampleLifeLineUndatedInterests, exampleMapLine } from "@/lib/map/fixtures";
import { NotForMe } from "@/components/map/not-for-me";
import { DeparturesView } from "@/components/departures/departures-view";
import { DEPARTURES_LEDE } from "@/lib/departures/filter";
import { JobSearchOffToday, JobSearchPaused, JobSearchProvider, JobSearchStatus, MeSearchSwitches } from "@/components/job-search/job-search";
import { NoticeCard } from "@/components/job-search/notice-card";
import { MeEditGallery } from "@/components/me/me-editors";
import { MeView } from "@/components/me/me-view";
import { NearbyLinesList } from "@/components/nearby/nearby-lines";
import { MarketView } from "@/components/market/market-view";
import { marketStates } from "@/content/market/places";
import { exampleMarketData, marketRoles } from "@/lib/market/data";
import { LIVE_FIXTURE_NOW, liveFixture, liveNothing } from "@/lib/market/fixtures";
import { liveMarket } from "@/lib/market/live";
import { MatchView } from "@/components/match/match-view";
import { ConfidenceSpark } from "@/components/practice/confidence-spark";
import { PracticeView } from "@/components/practice/practice-view";
import { LibraryView, ReportLink, SuggestPanel } from "@/components/library/library-view";
import { exampleEliteShelf, exampleLibrary, exampleLibraryNoResume } from "@/lib/library/fixtures";
import { exampleMatch } from "@/lib/match/fixtures";
import { exampleFeedback, examplePractice, examplePracticeSpent, exampleTrends } from "@/lib/practice/fixtures";
import { exampleNearby } from "@/lib/nearby/fixtures";
import { exampleSettings } from "@/components/settings/fixtures";
import { SettingsView } from "@/components/settings/settings-view";
import { SettingsDraft } from "@/components/settings/settings-draft";
import { LocationFields, MessageRequestsSwitch } from "@/components/settings/settings-fields";
import { UsuallyFree } from "@/components/inbox/usually-free";
import { InboxView, VerifiedBadge } from "@/components/inbox/inbox-view";
import { NetworkView } from "@/components/network/network-view";
import { ProfileConnect } from "@/components/network/profile-connect";
import { BuilderView } from "@/components/builder/builder-view";
import { EliteBadge } from "@/components/elite/elite-badge";
import { EliteView } from "@/components/elite/elite-view";
import { MePlanCard } from "@/components/elite/me-plan-card";
import { PlanCard } from "@/components/settings/plan-card";
import { MockView } from "@/components/mock/mock-view";
import { exampleDeparturesPrep, exampleMockFollowUp, exampleMockPage, exampleMockResult, exampleMockSession, exampleTimedReview, exampleTimedTest } from "@/lib/mock/fixtures";
import { CompanyAudit } from "@/components/corporate/audit-view";
import { CompanyChat, CompanyMessages } from "@/components/corporate/company-messages";
import { OverviewPanel } from "@/components/corporate/overview-panel";
import { CorporateHome, CorporateStart, RecheckPanel } from "@/components/corporate/corporate-home";
import {
  exampleApplications,
  exampleApplyPacket,
  exampleBoard,
  exampleCandidate,
  exampleCompanyChat,
  exampleCompanyInterviews,
  exampleCompanyMessages,
  exampleAudit,
  exampleCorporateHome,
  exampleCriteria,
  exampleFindPeople,
  exampleFoundChat,
  exampleFoundPerson,
  exampleInterviewerOverview,
  exampleOverview,
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
import { FindPeople } from "@/components/corporate/find-people";
import { BlockedPeople } from "@/components/settings/blocked-people";
import { CompanyDiscovery } from "@/components/settings/company-discovery";
import { MatchDots, MatchList } from "@/components/corporate/match-parts";
import { JobForm } from "@/components/corporate/job-form";
import { JobStatusBadge, PostedJobCard } from "@/components/corporate/job-parts";
import { JobReport } from "@/components/corporate/job-report";
import { JobsPanel } from "@/components/corporate/jobs-panel";
import { PostedJobs } from "@/components/departures/posted-jobs";
import { roleOptions, skillOptions } from "@/lib/corporate/job-content";
import { certificateOptions } from "@/lib/corporate/criteria";
import { CriteriaAsked, CriteriaList } from "@/components/corporate/criteria-parts";
import { ApplyPanel } from "@/components/departures/apply-panel";
import { OrgSignupForm } from "@/components/corporate/org-signup-form";
import { AntiScamLine, OrgStatusBadge, SecondAdminBanner, TestCodeBox } from "@/components/corporate/parts";
import { AdminCompanyRow, CompanyReview } from "@/components/admin/company-review";
import { JobCheckReview } from "@/components/admin/job-check-review";
import { BrokenLinkCard, LibraryReview, SuggestionCard } from "@/components/admin/library-review";
import { exampleHeldProofs, exampleInForce, exampleJobChecks, exampleLibraryQueue, exampleOpenMessageReport, exampleReports, exampleReportsNow, exampleReviewCompanies } from "@/components/admin/fixtures";
import { HiddenMessageRow, ReportReview, ReportRow, SuspendedAccountRow } from "@/components/admin/report-review";
import { SuspendedNotice } from "@/components/account/suspended-notice";
import { HeldProofRow, ProofReview } from "@/components/admin/proof-review";
import { exampleFoundThreads, exampleThreads } from "@/lib/inbox/fixtures";
import { exampleInCommon, exampleNetwork, exampleSearch } from "@/lib/network/fixtures";
import { exampleBuilder } from "@/lib/builder/fixtures";
import { builderRoles, builderRoleTools } from "@/lib/builder/roles";
import { exampleMe, exampleStoryGoals } from "@/lib/me/fixtures";
import { publicProfile } from "@/lib/me/public";
import { DEFAULT_SETTINGS } from "@/lib/schemas";
import { exampleApplied, exampleJobs, exampleLiveApplied, exampleLiveJobs, exampleLiveSaved, exampleSaved } from "@/lib/departures/fixtures";
import { TodayStatePreview, type TodayData } from "@/components/today/today-preview";
import { RideCard } from "@/components/today/ride-card";
import { DeparturesBoard } from "@/components/today/departures-board";
import { OnYourLineCard } from "@/components/today/rail-cards";
import { SignalCheckCard } from "@/components/today/signal-check";
import { boardRows } from "@/lib/today/live-board";
import type { JobCheckView } from "@/lib/jobs/groups";
import type { RoleCertificationView, RoleSkillView, RoleView } from "@/lib/role-view";
import type { Gap, GoalsSummary, Profile } from "@/lib/schemas";
import {
  exampleDepartures,
  exampleEvents,
  exampleFirstTally,
  exampleFirstTasks,
  exampleGoals,
  exampleGoalsWithTracks,
  exampleName,
  exampleOnYourLine,
  exampleRide,
  exampleSignalCheck,
  exampleRole as exampleTargetRole,
  exampleTrackPicker,
  exampleWeek,
} from "@/lib/today/fixtures";

export const metadata: Metadata = { title: "Design system · CareerMetro", robots: { index: false } };

/** Today's live board from the example live posts, grouped the way a signed-in person's board is (static data). */
const exampleLiveBoard = boardRows(exampleLiveJobs, (slug) => (slug === "data-analyst" ? "Data Analyst" : null));

// Example data only: shows every component in a realistic state.
/** Today's goals with "Not for me" offers: a required goal to skip, a "one of these" goal to swap. */
const notForMeToday: GoalsSummary = {
  ...exampleGoals,
  goals: exampleGoals.goals.map((g, i) =>
    i === 0
      ? { ...g, notForMe: { kind: "skip" as const, share: "Asked for in 75% of the job posts we checked for this role." } }
      : i === 1
        ? { ...g, notForMe: { kind: "swap" as const, current: g.name, options: [{ skillId: "tableau", name: "Tableau" }, { skillId: "looker", name: "Looker" }] } }
        : g,
  ),
};

/** A goal from a gap, not proved, for the "Not for me" examples. */
const notForMeGoal = exampleMapLine.goals.find((g) => g.skillId === "power-bi")!;

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

const colors = ["accent", "ink", "muted", "line", "line-strong", "surface-2", "accent-soft", "bad", "warn", "good", "board", "board-ink", "board-dim", "board-line", "heat-1", "heat-2", "heat-3", "heat-4", "heat-5", "elite", "elite-soft", "on-elite"] as const;

// Live counts for the Market section, from synthetic reads (src/lib/market/fixtures.ts).
const liveOpts = { now: LIVE_FIXTURE_NOW, roles: marketRoles.map((r) => r.slug), states: marketStates };
const designLive = liveMarket(liveFixture, liveOpts).market;
const designLiveEmpty = liveMarket(liveNothing, liveOpts).market;
const designLiveFailed = liveMarket(liveNothing, { ...liveOpts, failed: true }).market;

// Example data includes content still waiting for review, so production never serves this page (T73).
export default function DesignPage() {
  if (!designGalleryEnabled()) notFound();
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
        <p className="text-sm text-muted">Error and not-found pages. Says what happened and gives a way forward. Then an error page while the browser is offline.</p>
        <div className="rounded-lg border border-line bg-surface">
          <PageNotice title="We can't find that page" text="The link may be old, or the page may belong to someone else.">
            <ButtonLink href="/">Go to the home page</ButtonLink>
          </PageNotice>
        </div>
        <div className="rounded-lg border border-line bg-surface">
          <PageNotice title={OFFLINE_NOTICE.title} text={`${OFFLINE_NOTICE.text} Your goals and progress are safe.`}>
            <Button type="button">Try again</Button>
            <ButtonLink href="/today" variant="ghost">
              Go to Today
            </ButtonLink>
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
          <Button busy>Reading your resume…</Button>
        </div>
        <p className="text-sm text-muted">A busy button keeps keyboard focus while its work runs; disabled would drop focus to the page.</p>
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
        <TodayStatePreview data={exampleToday} upload={<UploadForm demo rolePick sample />} />
        <p className="text-sm text-muted">
          Live cards for a signed-in person: the signal check is checked on the server (waiting for the answer, and after a try that didn&apos;t go
          through); the board is grouped by role and city from live posts, or says why it is empty; On your line on the first day has no tip until
          Junction, and is hidden below three people.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <SignalCheckCard check={exampleSignalCheck} answered pickedKey="B" reveal={null} label="Signal check, waiting for the answer" />
          <SignalCheckCard
            check={exampleSignalCheck}
            answered={false}
            pickedKey={null}
            reveal={null}
            error="That didn't go through. Please try again."
            label="Signal check, after a failed try"
          />
          <DeparturesBoard rows={exampleLiveBoard} allHref="/departures" label="Departures, live rows" />
          <DeparturesBoard rows={[]} allHref="/departures" label="Departures, no rows yet" />
          <OnYourLineCard line={{ ...exampleOnYourLine, tip: null }} firstDay label="On your line, first day" />
        </div>
        <p className="text-sm text-muted">Every goal proved: the train is at Match and the ride points to the roles to board.</p>
        <RideCard name={exampleName} greeting="Evening" ride={arrivedRide(10)} week={exampleWeek} />
        <p className="text-sm text-muted">Your goals with a &quot;Your choice&quot; goal, added from a job check: listed apart, its own spur, never moving the train.</p>
        <div className="max-w-xl">
          <GoalsCard summary={exampleChoiceGoals} mapHref="/map" demo />
        </div>
        <p className="text-sm text-muted">
          Your goals with the Track picker (docs/plans/tracks-plan.md): the chip opens it; each track shows its goals, and picking one previews it with Switch track. Draft tracks, local and preview only until reviewed; in production the chip stays plain text.
        </p>
        <div className="max-w-xl">
          <GoalsCard summary={exampleGoalsWithTracks} mapHref="/map" demo />
        </div>
        <p className="text-sm text-muted">The Track panel on its own, open.</p>
        <div className="max-w-xl">
          <TrackPanel id="design-track-panel" open picker={exampleTrackPicker} demo />
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
        <p className="text-sm text-muted">
          Life line, Interests row: interests added on Me have no dates, so they run as one undated row and the panel lists them with a link to edit them.
          With none yet, the row links to the profile to add them.
        </p>
        <MetroMap line={exampleMapLine} life={exampleLifeLineUndatedInterests} initialMode="life" />
        <MetroMap line={exampleMapLine} life={exampleLifeLineNoInterests} initialMode="life" />
        <MetroMap line={null} />
        <p className="text-sm text-muted">From the sample resume: the Sample tag sits beside the title on both lines.</p>
        <MetroMap line={exampleMapLine} life={exampleLifeLine} sample />
        <p className="text-sm text-muted">With &quot;Your choice&quot; goals: off the line, listed under the key, each with its tag and Remove from my goals.</p>
        <MetroMap line={exampleChoiceMapLine} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Departures (signed in)</h2>
        <p className="text-sm text-muted">
          Roles with readiness in words, filters, Saved and Applied, the detail panel with Interview prep for this role (on Free: one question open, the
          rest locked; the MIS, trainer and freelance roles say it is coming), and the paste box checking a post against the resume. Then the same on Elite,
          and the page before a resume, whose paste box links to the upload.
        </p>
        <DeparturesView jobs={exampleJobs} initialSaved={exampleSaved} initialApplied={exampleApplied} resumeId="example" prep={exampleDeparturesPrep(exampleJobs, false)} demo />
        <DeparturesView jobs={exampleJobs.slice(1, 3)} resumeId="example" prep={exampleDeparturesPrep(exampleJobs, true)} demo />
        <DeparturesView jobs={exampleJobs.slice(0, 3)} hasResume={false} prep={exampleDeparturesPrep(exampleJobs, false)} />
        <p className="text-sm text-muted">
          Live roles from public company job boards (docs/plans/departures-live-plan.md): &quot;Updated 19:42&quot; in the header, Apply on company site
          opening the post in a new tab and then asking &quot;Did you apply?&quot;, a role that closed on its company&apos;s board (off All, still in Saved and
          Applied with its tracker, no Apply), and a post that names too few skills we know (no fit). Then the board before the first feed run, and Saved
          with nothing saved.
        </p>
        <DeparturesView
          jobs={exampleLiveJobs}
          initialSaved={exampleLiveSaved}
          initialApplied={exampleLiveApplied}
          updated="Updated 19:42"
          resumeId="example"
          prep={exampleDeparturesPrep(exampleLiveJobs, false)}
          demo
        />
        <DeparturesView jobs={exampleLiveJobs.slice(1, 2)} updated="Updated 18 Oct" resumeId="example" demo />
        <p className="text-sm text-muted">
          &quot;Your places&quot; (FR-55): with places in Settings &gt; Pay and location, the City filter opens on Your places, the roles in those cities and
          remote roles when Remote is picked; Any city still lists every role. Then places with no roles yet: the empty state links to Settings.
        </p>
        <DeparturesView jobs={exampleJobs} places={["Remote", "Bengaluru"]} resumeId="example" demo />
        <DeparturesView jobs={exampleJobs.slice(0, 3)} places={["Kochi"]} resumeId="example" demo />
        <p className="text-sm text-muted">
          No open roles at all: the empty list points to the paste box. Filters that hide every role offer Clear filters, and an empty Saved or Applied
          tab offers See all roles.
        </p>
        <DeparturesView jobs={[]} updated="Updated 07:00" resumeId="example" demo />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Job search and notice period (signed in)</h2>
        <p className="text-sm text-muted">
          &quot;Looking for a job&quot; off: Departures (and Arrivals, the same card) show the header and the off card only, and Today shows its card in the
          board&apos;s place. Turn on works here, nothing saves. Then the status line on Me, on and off, and Me&apos;s switches.
        </p>
        <JobSearchProvider initialOn={false}>
          <JobSearchPaused title="Departures" lede={DEPARTURES_LEDE} />
          <div className="max-w-md">
            <JobSearchOffToday />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <JobSearchStatus employer="Konkan Co-operative Bank" />
          </div>
        </JobSearchProvider>
        <JobSearchProvider initialOn>
          <div className="flex max-w-xs flex-col gap-3">
            <JobSearchStatus employer="Konkan Co-operative Bank" />
            <MeSearchSwitches />
          </div>
        </JobSearchProvider>
        <p className="text-sm text-muted">
          The notice period card, private: no days yet, 30 days picked (I have resigned asks for the date, then Start countdown), and a countdown
          from 1 Oct with 60 days, seen on 20 Oct (cobalt, since it is progress). Example data, so nothing saves.
        </p>
        <div className="grid max-w-3xl gap-4">
          <NoticeCard initial={{ days: null, resignedOn: null }} today="2026-10-20" />
          <NoticeCard initial={{ days: 30, resignedOn: null }} today="2026-10-20" />
          <NoticeCard initial={{ days: 60, resignedOn: "2026-10-01" }} today="2026-10-20" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Your profile (signed in)</h2>
        <p className="text-sm text-muted">
          The person&apos;s own profile with &quot;View as others&quot;, stories on a Board or List with the SMART check (a full one, &ldquo;Month-end
          reports&rdquo;, and a partial one with its hint, &ldquo;A branch report&rdquo;), and a role and a course marked &ldquo;Added by you&rdquo; with
          Edit and Delete. Example data, so nothing saves.
        </p>
        <MeView
          me={exampleMe}
          others={publicProfile(exampleMe, DEFAULT_SETTINGS)}
          whoSees={{ visibility: "Everyone signed in", link: "priya-n", shown: ["experience", "education", "skills", "certifications"] }}
          practice={exampleTrends}
          planCard={<MePlanCard plan={{ elite: false, badgeShown: false, since: null }} />}
          storyGoals={exampleStoryGoals}
        />
        <h3 className="text-lg font-semibold">Me editing: the forms</h3>
        <p className="text-sm text-muted">
          docs/plans/me-editing-plan.md: &ldquo;+ Add role&rdquo; and Edit on an added role, Education&apos;s &ldquo;+ Add&rdquo;, &ldquo;+ Add
          story&rdquo; and Edit (each part up to 400 characters with a live count, at least one box, an optional goal), the delete question, and the
          interests chips with remove and Add. Each opens inline on the page. Text others read refuses email addresses, phone numbers and links.
        </p>
        <MeEditGallery
          role={exampleMe.experience.find((e) => e.added) ?? exampleMe.experience[0]}
          education={exampleMe.education.find((e) => e.added) ?? exampleMe.education[0]}
          story={exampleMe.stories[2]}
          goals={exampleStoryGoals}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Certifications on a profile</h2>
        <p className="text-sm text-muted">
          Pending item 13: from accepted certificates and the resume. The owner sees every one, the reason a Credly check didn&apos;t verify one, an
          expired one marked, and Check with Credly (example data, so nothing is checked). Others see at most 5 current ones: Verified with Credly
          first, with the public badge link, then Added by the person.
        </p>
        <div className="grid gap-6 min-[760px]:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
            <h3 id="design-certs-own" tabIndex={-1} className="text-[0.95rem] font-semibold">
              Your own profile
            </h3>
            <ProfileCertifications certs={exampleMe.certifications} mode="own" ownerName={exampleMe.name} headingId="design-certs-own" />
          </div>
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
            <h3 className="text-[0.95rem] font-semibold">What others see</h3>
            <ProfileCertifications certs={publicProfile(exampleMe, DEFAULT_SETTINGS).certifications} mode="public" ownerName={exampleMe.name} />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Someone&apos;s profile (/u/username)</h2>
        <p className="text-sm text-muted">
          What a signed-in person sees at a profile link, worked out on the server from the owner&apos;s privacy switches: here with the target role
          and gaps turned on. Resume lines, pay, phone, email and notice period never show. Empty parts are left out.
        </p>
        <MeView me={publicProfile({ ...exampleMe, headline: "IT support moving into security operations" }, { ...DEFAULT_SETTINGS, showTargetRole: true, showGaps: true })} mode="public" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Nearby lines (Me and Map)</h2>
        <p className="text-sm text-muted">
          Roles sharing at least half their key skills, worked out by the matcher from a synthetic profile. On the Map each one that shares a goal is an
          interchange station (see the Map above). Below: the empty state, with and without a closest role.
        </p>
        <NearbyLinesList nearby={exampleNearby} changeRoleHref="/design" />
        <NearbyLinesList nearby={{ lines: [], closest: { slug: "data-scientist", title: "Data Scientist", shared: 2, total: 8 } }} />
        <NearbyLinesList nearby={{ lines: [], closest: null }} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Market (signed in)</h2>
        <p className="text-sm text-muted">
          Search, role and place pickers, the tile map in five plum steps with its key and list, the place panel, trend, pay bands, top cities, compare and
          Nearby lines. Every figure is example data; picking something opens /market. Below it, Mizoram picked: a thin place shows &quot;Not enough data&quot;.
        </p>
        <MarketView ids="design-market" params={{ place: "KA" }} nearby={{ nearby: exampleNearby, changeRoleHref: null, example: true }} today={new Date("2026-10-13T00:00:00Z")} market={exampleMarketData} />
        <MarketView ids="design-market-thin" params={{ place: "MZ", map: "pay", role: "soc-lead" }} nearby={{ nearby: null, changeRoleHref: null, example: true }} today={new Date("2026-10-13T00:00:00Z")} market={exampleMarketData} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Market on live counts (signed in)</h2>
        <p className="text-sm text-muted">
          What signed-in people see (docs/plans/market-trends-plan.md): open roles on public company job boards with the day they were read and the undercount
          note, no pay anywhere (&quot;Pay comes later&quot;, no Median pay map), and the trend saying &quot;Counting since&quot; until it has 12 months. The counts
          here are synthetic: Data Analyst has 15 open in Karnataka (shown) and 14 in Maharashtra (hidden). Below it, an empty database (CI&apos;s, a new
          staging): every figure reads &quot;Not enough data&quot;. Last, the counts couldn&apos;t be read: only that line and Nearby lines show, no figure and no &quot;Not enough data&quot;.
        </p>
        <MarketView ids="design-market-live" params={{ place: "KA" }} nearby={{ nearby: exampleNearby, changeRoleHref: null, example: true }} today={LIVE_FIXTURE_NOW} market={designLive} />
        <MarketView ids="design-market-live-empty" params={{ place: "MH", map: "pay" }} nearby={{ nearby: null, changeRoleHref: null, example: true }} today={LIVE_FIXTURE_NOW} market={designLiveEmpty} />
        <MarketView ids="design-market-live-failed" params={{}} nearby={{ nearby: null, changeRoleHref: null, example: true }} today={LIVE_FIXTURE_NOW} market={designLiveFailed} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Match (signed in)</h2>
        <p className="text-sm text-muted">
          Ready now, then Within N weeks at the hours a week picked (3, 6 or 10). Worked out by the matcher from a synthetic profile with three goals
          proved; the open-job counts are made up. Below it, the empty state with no resume.
        </p>
        <MatchView list={exampleMatch} />
        <MatchView list={null} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Practice (signed in)</h2>
        <p className="text-sm text-muted">
          The skill picker (the person&apos;s goals, tagged current, ahead or met), a bank question with the answer box and word count, then the feedback
          card in words with A stronger answer and the confidence question. Example data, so nothing is saved: Get feedback shows made-up feedback. Below
          it, the feedback card open, a met goal (&quot;keeps it sharp&quot;) at 0 answers left, the empty state, and the confidence sparkline on its own.
        </p>
        <PracticeView view={examplePractice} sampleFeedback={exampleFeedback} />
        <PracticeView view={examplePractice} initial={{ answer: "A list can change and a tuple can't, so I use tuples for fixed records.", feedback: exampleFeedback }} />
        <PracticeView view={{ ...examplePracticeSpent, skills: examplePracticeSpent.skills.filter((s) => s.tag === "met") }} sampleFeedback={exampleFeedback} />
        <PracticeView view={{ skills: [], left: 10, noQuestions: ["Statistics", "Data visualization"] }} />
        <div className="max-w-[300px] rounded-lg border border-line bg-surface p-4">
          <ConfidenceSpark ratings={[1, 2, 2, 3, 4]} width={260} height={70} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Library (signed in)</h2>
        <p className="text-sm text-muted">
          Handoff 12a, FR-51: For your goals (default) with one card per open goal in map order, each with Learn (or Brush up for a goal that starts
          at proof) and Prove, the courses on today&apos;s ride marked On your ride (progress, so cobalt), and Finished from the person&apos;s own
          ticks. Search, type, length and Hindi filters, the details panel with Open on the source site, How the Library is picked, and the Your
          interests, Saved and Finished tabs. Real catalog links with made-up goals. Below it, the Library with no resume.
        </p>
        <LibraryView view={exampleLibrary} shelf={exampleEliteShelf(false)} />
        <LibraryView view={exampleLibraryNoResume} shelf={exampleEliteShelf(false)} />
        <p className="text-sm text-muted">
          Handoff 12l, Elite part 5: the fifth tab, Elite, holds the Elite shelf. On Free (lock on the tab), every card says what it is and Opens with
          Elite, with the locked panel&apos;s Turn on Elite (violet) to /elite; no link or step is sent. With Elite: paid courses as Coming soon slots (no
          maker, price or link until a licensing deal), playbooks and drills we wrote (Not yet checked until someone in the role checks them;
          production shows only checked ones) and free sources from the catalog, the person&apos;s goals first.
        </p>
        <LibraryView view={exampleLibrary} shelf={exampleEliteShelf(false)} tab="elite" />
        <LibraryView view={exampleLibrary} shelf={exampleEliteShelf(true)} tab="elite" />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Library part 2: Save, I finished this, rides, reports and suggestions</h2>
        <p className="text-sm text-muted">
          docs/plans/library-part-2-plan.md: the bookmark on every row and in the details panel (pressed when saved), the Saved tab newest first with
          its count, &quot;I finished this&quot; (the person&apos;s own tick; it never fills a gap), Add to my rides, which reads On your rides
          once added, with Take it off my rides, and Link broken or out of date? Below, the Saved tab with an item added to the rides, then the report
          menu open, and the suggest panel with goal chips, with no goals (Other only) and with a pasted link. Toasts say what changed. Example data.
        </p>
        <LibraryView view={{ ...exampleLibrary, added: ["r3"], ticked: ["r10"] }} shelf={exampleEliteShelf(false)} tab="saved" initialSelected="r3" />
        <div className="grid gap-4 min-[760px]:grid-cols-3">
          <div className="rounded-lg border border-line p-4">
            <ReportLink title="DAX reference" initialOpen />
          </div>
          <SuggestPanel id="design-suggest-goals" goals={exampleLibrary.goals} />
          <SuggestPanel id="design-suggest-other" goals={[]} initialUrl="https://www.kaggle.com/learn/pandas" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Account settings (signed in)</h2>
        <p className="text-sm text-muted">
          Section list, Your plan (You&apos;re on Free with what Elite adds and See Elite; nothing can be bought), name, username with its
          availability check and headline, the locked email, how the person signs in, private pay, privacy (who can open the profile and what it
          shows, gaps, connection requests from, switches in ink, the Who sees what table and blocked people with Unblock), notifications stored for
          when email is on (with Language: English, Hindi coming later), download and delete with its DELETE check. Example data, so nothing saves. Then Blocked people with nobody blocked.
        </p>
        <div className="rounded-lg border border-line px-4 pt-6">
          <SettingsView data={exampleSettings} />
        </div>
        <div className="max-w-[640px] rounded-lg border border-line p-4">
          <BlockedPeople people={[]} />
        </div>
        <p className="text-sm text-muted">
          Pay and location with no places picked yet (the example above has Remote and Pune), and &quot;Allow message requests from people who aren&apos;t
          connections&quot; switched off (on above). Example data, so nothing saves.
        </p>
        <div className="flex max-w-[820px] flex-col gap-4 rounded-lg border border-line p-4">
          <SettingsDraft
            initial={{ ...exampleSettings.draft, city: "", openToWorkIn: [], settings: { ...exampleSettings.draft.settings, messageRequests: false } }}
            editable={false}
          >
            <LocationFields idPrefix="design-acc" />
            <MessageRequestsSwitch />
          </SettingsDraft>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Inbox (signed in)</h2>
        <p className="text-sm text-muted">
          Applications, people and message requests, the open chat with the interview-times picker, and the private availability panel. Example data, so
          nothing sends.
        </p>
        <InboxView threads={exampleThreads} />
        <p className="text-sm text-muted">
          Signed in, the availability panel has Usually free (FR-55): Monday to Friday by the picker&apos;s times, one row per day, with the summary worked out
          in code; set, then not set. Private: it only pre-ticks open times when a company asks for times. Example data, so nothing saves.
        </p>
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <div className="max-w-[300px] rounded-[20px] border border-line bg-surface p-4">
            <UsuallyFree initial={["mon 17:00", "mon 18:00", "tue 17:00", "tue 18:00", "wed 17:00", "wed 18:00", "thu 17:00", "thu 18:00", "fri 17:00", "fri 18:00"]} />
          </div>
          <div className="max-w-[300px] rounded-[20px] border border-line bg-surface p-4">
            <UsuallyFree initial={[]} />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Build your resume (signed in)</h2>
        <p className="text-sm text-muted">
          Seven sections one card at a time with the section list (numbered dots on phone) and a cobalt bar for sections done, then the review page:
          each line opens the answer it came from, &ldquo;Skills we found&rdquo; with sources, and the required &ldquo;Everything here is true and
          mine.&rdquo; tick. Example answers, so nothing saves.
        </p>
        <BuilderView data={{ ...exampleBuilder, roles: builderRoles, roleTools: builderRoleTools }} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Elite (signed in)</h2>
        <p className="text-sm text-muted">
          Handoff 12l, FR-50: free in the beta, no billing. The /elite page on Free (the Turn on button in Elite violet, never cobalt), the Free and
          Elite table, the prices after the beta (not charged now, not final) and the verified tick, never for sale. Then the page with Elite on, the
          badge next to a name, the plan card on your own profile (Free, and Elite with the badge switch), and Account settings, Your plan, both ways.
          Violet is for Elite only. Example data, so nothing changes.
        </p>
        <EliteView plan={{ elite: false, badgeShown: false, since: null }} roleTitle="Cyber Security Analyst" />
        <EliteView plan={{ elite: true, badgeShown: true, since: "19 Oct 2026" }} idPrefix="design-elite-on" />
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
          <span className="text-[1.2rem] font-semibold">
            Priya Nair
            <EliteBadge className="ml-2.5" />
          </span>
        </div>
        <MePlanCard plan={{ elite: false, badgeShown: false, since: null }} />
        <MePlanCard plan={{ elite: true, badgeShown: false, since: "19 Oct 2026" }} />
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-4">
            <PlanCard plan={{ elite: false, badgeShown: false, since: null }} />
          </div>
          <div className="rounded-lg border border-line bg-surface p-4">
            <PlanCard plan={{ elite: true, badgeShown: true, since: "19 Oct 2026" }} />
          </div>
        </div>
        <p className="text-sm text-muted">Practice with Elite on: no daily cap of 10.</p>
        <PracticeView view={{ ...examplePractice, left: null }} sampleFeedback={exampleFeedback} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Interview prep (signed in)</h2>
        <p className="text-sm text-muted">
          Handoff 12l, FR-50 part 2: /mock with its three tabs. On Free, the locked panel with Turn on Elite (violet) over the question bank, 5
          questions open and the rest locked. With Elite: a timed test running (the clock turns ink in the last minute; cobalt is only the progress
          bar), then its review with the count right, the only number. The mock interview (part 3): locked on Free; the set-up (role, Quick or
          Full, focus, the AI note; Speaking shows only where the browser turns speech to text on the device); a quick round running with the
          countdown and the cobalt progress bar; the feedback in words with What worked and Add next time, a skipped question linking to the bank;
          and the screen when feedback isn&apos;t available today. No score anywhere. Example data from the real bank for Data Analyst, so nothing
          saves. Follow-ups (docs/plans/mock-followups-plan.md): the set-up note says the interviewer asks them; the round running on a follow-up
          from the bank (&quot;Follow-up · topic&quot;, Skip follow-up, the count and progress bar unchanged); the Elite bank listing each open
          question&apos;s follow-ups to study; a feedback item with the follow-up and its reply, and one with &quot;Follow-up skipped.&quot;
        </p>
        <MockView view={exampleMockPage("data-analyst", false)} tab="bank" />
        {exampleTimedTest && <MockView view={exampleMockPage("data-analyst", true, exampleTimedTest)} tab="test" />}
        {exampleTimedReview && <MockView view={exampleMockPage("data-analyst", true)} tab="test" initialReview={exampleTimedReview} />}
        <MockView view={exampleMockPage("grc-manager", true)} tab="test" />
        <MockView view={exampleMockPage("data-analyst", false)} tab="interview" />
        <MockView view={exampleMockPage("data-analyst", true)} tab="interview" />
        <MockView view={exampleMockPage("data-analyst", true, null, exampleMockSession)} tab="interview" />
        <MockView view={exampleMockPage("data-analyst", true, null, exampleMockSession)} tab="interview" initialInterviewFollowUp={exampleMockFollowUp} />
        <MockView view={exampleMockPage("data-analyst", true)} tab="bank" />
        <MockView view={exampleMockPage("data-analyst", true)} tab="interview" initialInterviewResult={exampleMockResult} />
        <MockView
          view={exampleMockPage("data-analyst", true)}
          tab="interview"
          initialInterviewResult={{
            ...exampleMockResult,
            feedback: "unavailable_today",
            summary: null,
            items: exampleMockResult.items.map((i) => ({ ...i, whatWorked: null, addNextTime: null, followUp: i.followUp ? { ...i.followUp, answer: null } : null })),
          }}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Network (signed in)</h2>
        <p className="text-sm text-muted">
          The &ldquo;Let people find me&rdquo; bar, then Connections, Requests, Sent and Find people with counts. Rows show the verified tick, handle,
          target role only when shown, skills in common and the date (never a city: only companies see it); Connect opens the how-you-know pick inline, Remove and Block confirm inline,
          and Report opens a reason pick inline (the Inbox&rsquo;s review queue). Find people has the optional filters Aiming for my role and Verified (matched on the
          server; no city filter, since only companies see a member&rsquo;s city). Below: &ldquo;On your line&rdquo; (Later) and the Mentors teaser (after the beta). Example data, so nothing sends; Find people shows
          example results.
        </p>
        <NetworkView data={exampleNetwork} example={exampleSearch} />
        <p className="text-sm text-muted">
          Empty Network: no connections (Find someone you know, Copy your profile link), and on the Requests and Sent tabs a next step each (Copy your
          profile link, Find someone you know).
        </p>
        <NetworkView data={{ ...exampleNetwork, connections: [], requests: [], sent: [], profileLink: "/u/arjun-m" }} example={exampleSearch} />
        <h3 className="text-lg font-semibold">On a profile: connect, shared counts and In common with you</h3>
        <p className="text-sm text-muted">
          The strip of shared counts, then interests both list, skills, &ldquo;Gaps and path&rdquo; (only when the viewer may see the owner&rsquo;s gaps
          and both aim at the role the owner shows) and mutual connections (only people both know). Then with nothing in common: no gaps shown and no
          mutual connections.
        </p>
        <ProfileConnect personId="ex-am" name="Arjun Mehta" initial="connected" inCommon={exampleInCommon} />
        <ProfileConnect personId="ex-ak" name="Aditi Kulkarni" initial="none" inCommon={{ skills: [], role: null, path: null, mutual: [] }} />
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
        <p className="text-sm text-muted">Corporate when a role&apos;s 180-day work-email re-check is due: access is paused until the person confirms the email again.</p>
        <div className="rounded-lg border border-line p-4">
          <RecheckPanel company="Example Labs" domain="example-labs.in" open />
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
        <h2 className="text-2xl font-semibold">Current job checked by work email</h2>
        <p className="text-sm text-muted">
          FR-47: the profile above shows &quot;Verified with work email&quot; on the current job. Before a check, the owner sees Not verified and Verify
          with your work email (example data, so nothing is sent). Below, /admin/companies lists checks whose domain isn&apos;t that of a company
          CareerMetro verified under the employer&apos;s name: the company, the domain and the day, never the person.
        </p>
        <MeView
          me={{ ...exampleMe, experience: exampleMe.experience.map((e, i) => (i === 0 ? { ...e, check: { state: "not_verified" as const, month: null } } : e)) }}
          jobCheck={{ open: true }}
        />
        <div className="rounded-lg border border-line p-4">
          <JobCheckReview checks={exampleJobChecks} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <JobCheckReview checks={[]} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Not for me</h2>
        <p className="text-sm text-muted">
          FR-48: at the foot of a goal&apos;s pitstops on the Map. A required goal can be skipped anyway (it stays a gap, and the train passes it); a
          &quot;one of these&quot; goal can be swapped to another skill of its group; a skipped goal can be brought back. Example data, so nothing
          changes.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <NotForMe demo goal={{ ...notForMeGoal, notForMe: { kind: "skip", share: "Asked for in 75% of the job posts we checked for this role." } }} />
          <NotForMe
            demo
            goal={{
              ...notForMeGoal,
              skillId: "aws",
              name: "AWS",
              notForMe: { kind: "swap", current: "AWS", options: [{ skillId: "azure", name: "Microsoft Azure" }, { skillId: "gcp", name: "Google Cloud" }] },
            }}
          />
          <NotForMe demo goal={{ ...notForMeGoal, skipped: true }} />
        </div>
        <p className="text-sm text-muted">On Today, in an open goal: the same choices. A skipped goal leaves the list and comes back from the Map.</p>
        <div className="max-w-xl">
          <GoalsCard summary={notForMeToday} mapHref="/map" demo />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Held proofs (admins only)</h2>
        <p className="text-sm text-muted">
          /admin/proofs: certificates held because their credential id or Credly badge is already on another account. One row per claim with the person
          as first name and last initial, the reason in words, the date, how many other accounts hold it and the Credly badge page. Accept for this person
          and Reject. Example data, so the buttons do nothing.
        </p>
        <HeldProofRow proof={{ ...exampleHeldProofs[0]!, id: "5f4e3d2c-1b0a-4f9e-8d7c-6b5a4f3e2d1c" }} pending={false} />
        <p className="text-sm text-muted">The whole page, and the list with nothing left to review.</p>
        <div className="rounded-lg border border-line p-4">
          <ProofReview proofs={exampleHeldProofs} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <ProofReview proofs={[]} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Library review (admins only)</h2>
        <p className="text-sm text-muted">
          /admin/library: Broken links, one row per link with open reports (counts by reason, first report, the link check&apos;s last result) and
          links already hidden, with Hide link, Show again and Dismiss reports; Suggestions with the link (opened by the admin in a new tab, no
          referrer), the host, the goal chip and the date, with Accept, Already in the Library and Decline with its reason. No reporter or suggester
          is shown. Example data, so the buttons do nothing.
        </p>
        {/* Their own ids, so the rows below don't repeat the whole page's. */}
        <BrokenLinkCard row={{ ...exampleLibraryQueue.broken[0]!, id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d" }} pending={false} />
        <BrokenLinkCard row={{ ...exampleLibraryQueue.broken[1]!, id: "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e" }} pending={false} />
        <SuggestionCard row={{ ...exampleLibraryQueue.suggestions[0]!, id: "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f" }} pending={false} />
        <p className="text-sm text-muted">The whole page, and the page with nothing waiting.</p>
        <div className="rounded-lg border border-line p-4">
          <LibraryReview queue={exampleLibraryQueue} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <LibraryReview queue={{ broken: [], suggestions: [] }} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Reports (admins only)</h2>
        <p className="text-sm text-muted">
          /admin/reports: open reports from chats and job pages, oldest first. The reason, what was reported with the message or job title, who reported
          it as first name and last initial, their note, and the deadlines; a passed one reads Overdue in words, not colour. Acknowledge, Action taken and
          Dismiss. Example data, so the buttons do nothing.
        </p>
        <ReportRow report={{ ...exampleReports[1]!, id: "7b6a5f4e-3d2c-4b1a-8f9e-8d7c6b5a4f3f" }} now={exampleReportsNow} pending={false} />
        <p className="text-sm text-muted">
          The removal tools (FR-46): a report about a message offers Hide message, and one that points at a person&apos;s account offers Suspend
          account. Each opens a small form in the row with a required reason and confirms; what is in force reads in words, never in a status colour.
          Below, the hidden messages and suspended accounts in force, each with its undo.
        </p>
        <ReportRow report={exampleOpenMessageReport} now={exampleReportsNow} pending={false} />
        <HiddenMessageRow message={{ ...exampleInForce.messages[0]!, id: "4c3b2a1f-0e9d-4c8b-9a7f-6e5d4c3b2a17" }} off={false} />
        <SuspendedAccountRow account={{ ...exampleInForce.accounts[0]!, id: "5d4c3b2a-1f0e-4d9c-8b8a-7f6e5d4c3b28" }} off={false} />
        <p className="text-sm text-muted">The whole page, and the list with nothing open.</p>
        <div className="rounded-lg border border-line p-4">
          <ReportReview reports={exampleReports} now={exampleReportsNow} inForce={exampleInForce} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <ReportReview reports={[]} now={exampleReportsNow} inForce={{ messages: [], accounts: [] }} />
        </div>
        <p className="text-sm text-muted">
          /account/suspended: what a suspended person sees instead of any signed-in page, with the admin&apos;s reason and the grievance officer.
        </p>
        <div className="rounded-lg border border-line p-4">
          <SuspendedNotice reason="Asked people for money to book interviews." />
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
          <JobForm data={{ ...exampleJobFormData, roles: roleOptions(), skills: skillOptions(), certificates: certificateOptions() }} initial={null} today="2026-10-13" />
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
          Build step 4: Express apply (its preview and consent) on Departures (one card per state: can apply, applied, no resume, signed out), Match to this job in
          words, a job&apos;s six-lane board with the candidate drawer (open a card), and Arrivals: Moving forward, Offers (empty: where offers will
          land), Waiting to hear with the &quot;more applied&quot; count, Not this time with the line to the goal on the person&apos;s line, and Add to calendar on
          an accepted interview (a calendar file download). Then Arrivals with no applications. Example data, so nothing saves or moves.
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
          <ArrivalsView applications={exampleApplications} today="2026-10-12" goalLinks={{ a5: { name: "SIEM", pitstop: 3 } }} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <ArrivalsView applications={[]} today="2026-10-12" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">Express apply (signed in)</h2>
        <p className="text-sm text-muted">
          Pending item 16: a posted job&apos;s Express apply criteria by name (signed out) and as met or not yet (signed in), neutral with icons since they
          aren&apos;t gaps; Express apply opens the preview dialog with exactly what the company receives, the note (300 characters, no email or phone) and
          the consent tick. Unmet criteria warn and never block. The company reads the note on the drawer&apos;s Profile tab and the criteria on Match to this
          job (open a card above). Example data, so nothing is sent.
        </p>
        <div className="grid gap-4 min-[900px]:grid-cols-2">
          <PostedJobCard
            job={examplePostedJob}
            criteria={exampleCriteria}
            apply={<ApplyPanel jobId={examplePostedJob.id} company={examplePostedJob.company} title={examplePostedJob.title} state={{ kind: "can_apply" }} example={exampleApplyPacket} />}
          />
          <PostedJobCard job={{ ...examplePostedJob, id: "example-job-signed-out", title: "SOC Analyst L1 (signed out)" }} />
        </div>
        <div className="grid gap-4 min-[900px]:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <CriteriaList criteria={exampleCriteria} warn />
          </div>
          <div className="flex flex-col gap-4 rounded-lg border border-line p-4">
            <CriteriaList criteria={{ ...exampleCriteria, lines: exampleCriteria.lines.map((l) => ({ ...l, met: true })), met: 2 }} title="All met" />
            <CriteriaList criteria={exampleCriteria} compact />
            <CriteriaAsked names={examplePostedJob.criteria} />
          </div>
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
        <h2 className="text-2xl font-semibold">Find people (signed in)</h2>
        <p className="text-sm text-muted">
          Pending item 19: a verified company&apos;s Recruiter admins and Hiring HR search from one of their open jobs for people who turned on &ldquo;Let companies find
          me&rdquo;, ranked by Match, proven skills first, filtered by experience, target role and verified profile, one or several together (T44), each card showing
          the target role; the drawer shows the public profile parts and Match, and sends one message request. Then the refused page an
          Interviewer sees, the person&apos;s side in Settings (companies that viewed them, blocked companies), the request and accepted chat in their Inbox, and the
          company&apos;s found chat. Example data, so nothing sends.
        </p>
        <div className="rounded-lg border border-line p-4">
          <FindPeople view={exampleFindPeople} example={exampleFoundPerson} />
        </div>
        <div className="rounded-lg border border-line p-4">
          <FindPeople view={{ ...exampleFindPeople, role: "interviewer", refusal: "interviewer", jobs: [], search: null, results: null, sent: [] }} />
        </div>
        <div className="max-w-[640px] rounded-lg border border-line p-4">
          <CompanyDiscovery data={exampleSettings.discovery} />
        </div>
        <InboxView threads={exampleFoundThreads} />
        {/* An accepted found chat while the person's job search is off (FR-52): it goes on, with one line saying so, and End chat. */}
        <InboxView threads={exampleFoundThreads.filter((t) => t.kind === "application").map((t) => ({ ...t, jobSearchOff: true }))} />
        {/* The same chat after End chat (FR-52): closed for both sides, with no report and no company block. End chat above opens its confirm. */}
        <InboxView threads={exampleFoundThreads.filter((t) => t.kind === "application").map((t) => ({ ...t, state: "closed" as const }))} />
        <div className="max-w-[720px]">
          <CompanyChat chat={exampleFoundChat} company="Example Labs" />
        </div>
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
        <h2 className="text-2xl font-semibold">Overview and audit (signed in)</h2>
        <p className="text-sm text-muted">
          Build step 7: the Overview on Corporate for a Recruiter admin (counts only), for an Interviewer (only the candidates they interview) and with no open
          job, an ended &quot;Ask for times&quot; card, and the company&apos;s audit, Recruiter admins only. Example data.
        </p>
        <div className="flex flex-col gap-4">
          <OverviewPanel view={exampleOverview} />
          <OverviewPanel view={exampleInterviewerOverview} />
          <OverviewPanel view={{ ...exampleOverview, openJobs: 0, newApplications: 0, interviewsToday: 0, interviewsThisWeek: 0, unreadChats: 0, jobs: [] }} />
        </div>
        <div className="max-w-[720px]">
          <CompanyChat
            chat={{
              ...exampleTimesChat,
              messages: exampleTimesChat.messages.map((m) => (m.times ? { ...m, times: { offered: null, ended: "unanswered" as const } } : m)),
              canAskTimes: false,
            }}
            company="Example Labs"
          />
        </div>
        <div className="rounded-lg border border-line p-4">
          <CompanyAudit view={exampleAudit} olderHref="#older" />
        </div>
        <div className="rounded-lg border border-line p-4">
          <CompanyAudit view={{ ...exampleAudit, lines: [] }} olderHref={null} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">App shell (signed in)</h2>
        <p className="text-sm text-muted">
          Top bar on desktop, tab bar under 760 px, avatar menu with the @handle under the name (Admin shows only for admins). Sections not built yet show as Soon. The
          first frame has the Arrivals count, which hides with no resume and on the first day, and the notifications bell with its dot; Network and Library leave the top bar under
          1240 px and Market under 1000 px, as all three are in the menu. The second frame
          has Elite on: the violet award mark on the avatar, and &ldquo;Elite · beta&rdquo; and &ldquo;Elite is on&rdquo; in its menu.
        </p>
        <div className="h-96 rounded-lg border border-line">
          <AppShell embedded user={{ name: "Priya Nair", handle: "priya-n", initials: "PN", streakDays: 11, todayCounted: false, showStreak: true, canSignOut: false, inboxUnread: 2, isAdmin: true, arrivalsCount: 3, notificationsNew: 2 }}>
            <p className="text-sm text-muted">Page content goes here.</p>
          </AppShell>
        </div>
        <div className="h-96 rounded-lg border border-line">
          <AppShell embedded user={{ name: "Priya Nair", initials: "PN", streakDays: 11, todayCounted: false, showStreak: true, canSignOut: false, inboxUnread: 0, elite: true }}>
            <p className="text-sm text-muted">Page content goes here.</p>
          </AppShell>
        </div>
        <h3 className="text-lg font-semibold">Notifications bell</h3>
        <p className="text-sm text-muted">
          Between the streak and the Inbox (docs/plans/notifications-plan.md). With something new its label is &ldquo;Notifications, 2 new&rdquo; and a small
          ink dot shows (never cobalt, which means progress); with nothing new, no dot. Opening it marks everything read and the dot clears; rows that were
          new stay bold until it closes. Under 760 px the panel fills the screen under the top bar. Below: the bell with and without the dot (open either for
          the examples), the panel with each kind, and the empty panel.
        </p>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2 text-sm text-muted">
            <NotificationsBell count={2} />2 new
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <NotificationsBell count={0} />
            Nothing new
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <NotificationsBell count={0} startItems={exampleNotifications} />
          <NotificationsBell count={0} startItems={[]} />
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
          <p className="text-sm text-muted">With a target role picked on Today before the upload: it shows first.</p>
          <RolePicker resumeId="example" roles={exampleRoleOptions} picked="data-analyst" demo />
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
          <JobCheckResult check={exampleJobCheck} resumeId="example" profileVersion={2} roleTitle="Data Analyst" planHref="/design" goals={{ skills: ["power-bi"], chosen: { "power-bi": "example-goal" }, here: "/design" }} demo />
          <p className="text-sm text-muted">Not signed in: goals are kept for an account.</p>
          <JobCheckResult
            resumeId="example"
            profileVersion={2}
            check={{ ...exampleJobCheck, id: "example-anonymous", alsoGoals: [], notAsked: [], covered: [], goodToHave: [], unknown: [] }}
            roleTitle="Data Analyst"
            planHref="/design"
            goals={{ skills: null, here: "/design" }}
            demo
          />
          <JobCheckResult
            resumeId="example"
            profileVersion={2}
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
              explanation: "As a rough estimate, about 28 hours of focused work closes the remaining gaps.",
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
          <p className="text-sm text-muted">Press Read my resume with the box ticked to see the four reading steps (they never upload here).</p>
          <h3 className="text-lg font-semibold">Upload states</h3>
          <p className="text-sm text-muted">A slow reading (after 40 seconds), a file we can&rsquo;t read, and today&rsquo;s reading budget spent, signed in.</p>
          <UploadForm demo example="slow" />
          <UploadForm demo example={{ message: "Please upload a PDF or Word (.docx) file, or paste your resume as text.", code: "unsupported_type" }} />
          <UploadForm demo builder example={{ message: "We've reached today's capacity for the beta. Please try again tomorrow.", code: "busy", signedIn: true }} />
        </div>
        <div className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">Resume check</h2>
          <ProfileEditor resumeId="example" initial={exampleProfile} demo />
          <p className="text-sm text-muted">Shown above the check once the resume is confirmed.</p>
          <ResumeDownload resumeId="example" named={false} demo />
          <p className="text-sm text-muted">
            The sample resume (&ldquo;Try a sample resume&rdquo; on Today): this note tops the check, and the tag also marks the Resume card on Me
            (&ldquo;Sample resume&rdquo;).
          </p>
          <SampleResumeNote />
          <div className="flex items-center gap-2 text-sm">
            Sample resume <SampleTag />
          </div>
          <p className="text-sm text-muted">On Today while the sample is the current resume; the Map&rsquo;s header (Role line and Life line) carries the tag too.</p>
          <SampleLineNote />
        </div>
      </section>
      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <h2 className="text-2xl font-semibold">Screening check</h2>
          <p className="text-sm text-muted">On the Gaps page, against the target role: a two-column PDF with a photo and renamed headings.</p>
          <ScreeningCheck view={exampleScreeningPdf} resumeId="example" demo />
          <p className="text-sm text-muted">A Word file with a table, text boxes and header text, against a role with a &ldquo;one of these&rdquo; group.</p>
          <ScreeningCheck view={exampleScreeningDocx} resumeId="example" demo />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-muted">Against a pasted job the resume fully covers, from a clean Word file.</p>
          <ScreeningCheck view={exampleScreeningReady} resumeId="example" demo />
          <p className="text-sm text-muted">Pasted resume text: no layout to check.</p>
          <ScreeningCheck view={exampleScreeningPasted} resumeId="example" demo />
          <p className="text-sm text-muted">Uploaded before the check: no flags, so it asks for the file again and never guesses.</p>
          <ScreeningCheck view={exampleScreeningOld} resumeId="example" demo />
          <p className="text-sm text-muted">The sample resume: no download, since it is a made-up person&apos;s.</p>
          <ScreeningCheck view={{ ...exampleScreeningPasted, sample: true }} resumeId="example" demo />
        </div>
      </section>
      <p className="font-mono text-xs text-muted">All names, numbers and dates on this page are examples.</p>
    </div>
  );
}
