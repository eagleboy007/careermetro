import type { CandidateView, CompanyChatView, CompanyMessagesView, CorporateHomeView, JobBoardView, JobFormData, JobMatchView, MyApplicationView, PostedJobView, SignupDetails } from "@/lib/corporate/types";

/** Made-up company and people for /design and the example preview. No real company or person. */
export const exampleCorporateHome: CorporateHomeView = {
  org: { name: "Example Labs", type: "company", domain: "example-labs.test", website: "https://example-labs.test", status: "pending", createdOn: "2026-10-12", hasPage: true },
  me: { role: "admin", since: "2026-10-12" },
  adminCount: 1,
  secondAdminDaysLeft: 12,
  canOpenJobs: false,
  jobs: {
    counts: { draft: 1, open: 1, paused: 1, closed: 1 },
    canPost: true,
    blocked: "pending",
    items: [
      { id: "j1", title: "SOC Analyst L1", roleTitle: "Cyber Security Analyst", city: "Pune", workType: "full_time", status: "open", live: false, createdOn: "2026-10-12", closedOn: null, ownerName: "Meera Iyer", myRole: "owner", canEdit: true, requiredCount: 6, applications: 5 },
      { id: "j2", title: "Data Analyst, payments", roleTitle: "Data Analyst", city: "Bengaluru", workType: "full_time", status: "draft", live: false, createdOn: "2026-10-13", closedOn: null, ownerName: "Rahul Menon", myRole: null, canEdit: true, requiredCount: 0, applications: 0 },
      { id: "j3", title: "Freelance QA tester", roleTitle: "QA Automation Engineer", city: "Remote", workType: "freelance", status: "paused", live: false, createdOn: "2026-10-12", closedOn: null, ownerName: "Meera Iyer", myRole: "owner", canEdit: true, requiredCount: 4, applications: 1 },
      { id: "j4", title: "Cloud Engineer", roleTitle: "Cloud Engineer", city: "Hyderabad", workType: "full_time", status: "closed", live: false, createdOn: "2026-10-12", closedOn: "2026-10-13", ownerName: "Meera Iyer", myRole: "owner", canEdit: false, requiredCount: 7, applications: 0 },
    ],
  },
  team: {
    members: [
      { id: "m1", name: "Meera Iyer", role: "admin", workEmailVerifiedOn: "2026-10-12", recheckDue: false, isYou: true },
      { id: "m2", name: "Rahul Menon", role: "hiring", workEmailVerifiedOn: "2026-10-13", recheckDue: false, isYou: false },
    ],
    invites: [{ id: "i1", role: "admin", domain: "example-labs.test", createdOn: "2026-10-13", expiresOn: "2026-10-27" }],
    requests: [{ id: "r1", name: "Farhan Shaikh", domain: "example-labs.test", createdOn: "2026-10-14" }],
  },
};

/** The Post a job form's company, colleagues and state, without the role and skill lists (the page adds those). */
export const exampleJobFormData: Omit<JobFormData, "roles" | "skills"> = {
  company: "Example Labs",
  companyVerified: false,
  blocked: "pending",
  colleagues: [
    { memberId: "m2", name: "Rahul Menon", role: "hiring" },
    { memberId: "m3", name: "Sana Qureshi", role: "interviewer" },
  ],
};

/** A job as Departures shows it, for /design. */
export const examplePostedJob: PostedJobView = {
  id: "example-job",
  title: "SOC Analyst L1",
  company: "Example Labs",
  city: "Pune",
  workType: "full_time",
  required: ["Networking basics", "Linux", "SIEM", "Threat detection", "Security incident response"],
  oneOf: [["Python", "Bash scripting"]],
  nice: ["Endpoint security", "Digital forensics"],
  postedOn: "2026-10-13",
};

export const exampleSignupDetails: SignupDetails = {
  type: "company",
  legalName: "Example Labs Private Limited",
  name: "Example Labs",
  website: "https://example-labs.test",
  workEmail: "meera.iyer@example-labs.test",
  size: "51 to 200",
  city: "Pune",
};

/* Applications and the board (build step 4): made-up candidates, never real people or resumes. */

const match = (states: JobMatchView["lines"][number]["state"][]): JobMatchView => {
  const labels = ["Networking basics", "Linux command line", "SIEM and log analysis", "Threat detection", "One of: Python, Bash scripting"];
  const lines = states.map((state, i) => ({ label: labels[i], state, group: (i === 4 ? "one_of" : "required") as "one_of" | "required" }));
  return {
    lines: [...lines, { label: "Endpoint security", state: "not_on_resume", group: "nice" }],
    requiredProved: states.filter((s) => s === "proved").length,
    requiredOnResume: states.filter((s) => s === "on_resume").length,
    requiredTotal: states.length,
  };
};

export const exampleBoard: JobBoardView = {
  job: { id: "j1", title: "SOC Analyst L1", city: "Pune", workType: "full_time", status: "open", aiRound: false, company: "Example Labs" },
  canMove: true,
  assignedOnly: false,
  withdrawn: 1,
  cards: [
    { applicationId: "a1", name: "Priya Nair", headline: "Working at Konkan Co-operative Bank", stage: "team", canJoin: "30", appliedOn: "2026-10-03", match: match(["proved", "proved", "on_resume", "proved", "on_resume"]) },
    { applicationId: "a2", name: "Arjun Mehta", headline: "Looking for a next role", stage: "offer", canJoin: "now", appliedOn: "2026-09-28", match: match(["proved", "proved", "proved", "proved", "proved"]) },
    { applicationId: "a3", name: "Meera Joshi", headline: "Working at Indus Health Systems", stage: "applied", canJoin: "60", appliedOn: "2026-10-03", match: match(["on_resume", "proved", "not_on_resume", "on_resume", "on_resume"]) },
    { applicationId: "a4", name: "Ananya Ghosh", headline: "Looking for a next role", stage: "shortlisted", canJoin: "now", appliedOn: "2026-10-06", match: match(["proved", "on_resume", "on_resume", "not_on_resume", "proved"]) },
    { applicationId: "a5", name: "Imran Qureshi", headline: "Working at Nimbus Retail Tech", stage: "not_this_time", canJoin: "90", appliedOn: "2026-09-29", match: match(["on_resume", "proved", "not_on_resume", "not_on_resume", "on_resume"]) },
  ],
};

export const exampleCandidate: CandidateView = {
  applicationId: "a1",
  stage: "team",
  canJoin: "30",
  appliedOn: "2026-10-03",
  profile: {
    name: "Priya Nair",
    headline: "Working at Konkan Co-operative Bank",
    experience: [
      { title: "IT security analyst", employer: "Konkan Co-operative Bank", dates: "Jun 2023 to now · 3 years 4 months" },
      { title: "Support intern", employer: "Garuda Logistics", dates: "Jan 2022 to Jun 2022 · 5 months" },
    ],
    education: [{ qualification: "B.Sc. IT", institution: "Pune University", year: "2023" }],
    certifications: ["Google Cybersecurity Certificate", "CompTIA Security+"],
  },
  match: exampleBoard.cards[0].match,
  events: [
    { kind: "applied", stage: "applied", on: "2026-10-03", note: null },
    { kind: "moved", stage: "shortlisted", on: "2026-10-05", note: null },
    { kind: "moved", stage: "team", on: "2026-10-08", note: null },
  ],
};

export const exampleApplications: MyApplicationView[] = [
  {
    id: "a1",
    title: "SOC Analyst L1",
    company: "Example Labs",
    city: "Pune",
    stage: "team",
    canJoin: "30",
    appliedOn: "2026-10-03",
    withdrawn: false,
    events: exampleCandidate.events,
  },
  {
    id: "a6",
    title: "Data Analyst, payments",
    company: "Sample Fintech",
    city: "Bengaluru",
    stage: "applied",
    canJoin: "30",
    appliedOn: "2026-10-10",
    withdrawn: false,
    events: [{ kind: "applied", stage: "applied", on: "2026-10-10", note: null }],
  },
  {
    id: "a5",
    title: "Security Analyst",
    company: "Demo Retail Tech",
    city: "Bengaluru",
    stage: "not_this_time",
    canJoin: "30",
    appliedOn: "2026-09-29",
    withdrawn: false,
    events: [
      { kind: "applied", stage: "applied", on: "2026-09-29", note: null },
      { kind: "moved", stage: "not_this_time", on: "2026-10-02", note: "We need hands-on SIEM for this role. Your Linux depth is strong; apply again once SIEM is proved." },
    ],
  },
];

/** Corporate Messages for a Recruiter admin (build step 5). Made-up people; no email or phone anywhere. */
export const exampleCompanyMessages: CompanyMessagesView = {
  company: "Example Labs",
  status: "verified",
  role: "admin",
  items: [
    { applicationId: "a1", name: "Priya Nair", job: "SOC Analyst L1", stage: "team", preview: "Happy to. I built three dashboards for branch login alerts.", at: "Tue 10:12", unread: true },
    { applicationId: "a4", name: "Ananya Ghosh", job: "SOC Analyst L1", stage: "shortlisted", preview: "Thanks for applying. We'll write again this week.", at: "Mon 16:40", unread: false },
  ],
};

export const exampleCompanyChat: CompanyChatView = {
  applicationId: "a1",
  jobId: "j1",
  job: "SOC Analyst L1",
  candidate: "Priya Nair",
  stage: "team",
  state: "open",
  messages: [
    { by: "system", who: "", text: "Applied on CareerMetro." },
    { by: "team", who: "Rahul Menon", text: "Thanks for applying, Priya. Could you tell us about the Splunk dashboards on your resume?", at: "Mon 11:02" },
    { by: "me", who: "You", question: true, text: "Which SIEM tools have you used on shift work?", at: "Mon 11:05" },
    { by: "candidate", who: "Priya Nair", text: "Happy to. I built three dashboards for branch login alerts.", at: "Tue 10:12" },
  ],
};
