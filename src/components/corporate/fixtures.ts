import type { CompanyAuditView, CompanyInterviewsView, CompanyOverviewView, SchedulerView } from "@/lib/corporate/types";
import type { InboxMessage } from "@/lib/inbox/types";
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
  interviews: {
    interviews: [
      {
        id: "iv1",
        round: "team",
        when: "Wed 14 Oct, 11:00",
        range: "11:00 to 11:45",
        minutes: 45,
        status: "accepted",
        interviewers: ["Sana Qureshi"],
        phoneShared: true,
        feedback: [],
        canGiveFeedback: false,
        canCancel: true,
      },
      {
        id: "iv0",
        round: "team",
        when: "Fri 9 Oct, 15:00",
        range: "15:00 to 15:30",
        minutes: 30,
        status: "done",
        interviewers: ["Rahul Menon", "Sana Qureshi"],
        phoneShared: false,
        feedback: [
          { by: "Sana Qureshi", mine: false, recommendation: "yes", text: "Walked through two real phishing alerts end to end and wrote clear incident notes.", on: "2026-10-09" },
          { by: "Rahul Menon", mine: false, recommendation: "not_sure", text: "Good on Linux, thin on cloud logs. A second look at SIEM queries would help.", on: "2026-10-09" },
        ],
        canGiveFeedback: false,
        canCancel: false,
      },
    ],
    phone: "+91 98765 43210",
    canSchedule: true,
    offeredTimes: 3,
    waitingForTimes: false,
  },
};

/** The drawer for an Interviewer on the candidate's interview: read only, with their own feedback form. */
export const exampleInterviewerCandidate: CandidateView = {
  ...exampleCandidate,
  interviews: {
    interviews: [{ ...exampleCandidate.interviews.interviews[0]!, canGiveFeedback: true, canCancel: false }],
    phone: "+91 98765 43210",
    canSchedule: false,
    offeredTimes: 0,
    waitingForTimes: false,
  },
};

/** The scheduler (build step 6): Priya offered five times; Sana is busy at one of them. Made-up people. */
export const exampleScheduler: SchedulerView = {
  applicationId: "a1",
  jobId: "j1",
  job: "SOC Analyst L1",
  candidate: "Priya Nair",
  company: "Example Labs",
  refusal: null,
  days: [
    { day: "2026-10-14", label: ["Wed", "14 Oct"] },
    { day: "2026-10-15", label: ["Thu", "15 Oct"] },
    { day: "2026-10-16", label: ["Fri", "16 Oct"] },
  ],
  times: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"],
  slots: [
    { id: "s1", key: "2026-10-14T11:00", day: "2026-10-14", time: "11:00", label: "Wed 14 Oct, 11:00", taken: true },
    { id: "s2", key: "2026-10-14T17:00", day: "2026-10-14", time: "17:00", label: "Wed 14 Oct, 17:00", taken: false },
    { id: "s3", key: "2026-10-15T10:00", day: "2026-10-15", time: "10:00", label: "Thu 15 Oct, 10:00", taken: false },
    { id: "s4", key: "2026-10-15T18:00", day: "2026-10-15", time: "18:00", label: "Thu 15 Oct, 18:00", taken: false },
    { id: "s5", key: "2026-10-16T15:00", day: "2026-10-16", time: "15:00", label: "Fri 16 Oct, 15:00", taken: false },
  ],
  team: [
    { memberId: "m1", name: "Meera Iyer", role: "admin", busyKeys: [], thisWeek: 0 },
    { memberId: "m2", name: "Rahul Menon", role: "hiring", busyKeys: [], thisWeek: 1 },
    { memberId: "m3", name: "Sana Qureshi", role: "interviewer", busyKeys: ["2026-10-15T10:00"], thisWeek: 2 },
  ],
  teamWeek: [
    { when: "Wed 14 Oct, 11:00", who: "Sana Qureshi" },
    { when: "Thu 15 Oct, 10:00", who: "Sana Qureshi" },
    { when: "Fri 16 Oct, 12:00", who: "Rahul Menon" },
  ],
  interviews: exampleCandidate.interviews.interviews.slice(0, 1),
  waitingForTimes: false,
};

/** Corporate Interviews for a Recruiter admin. */
export const exampleCompanyInterviews: CompanyInterviewsView = {
  company: "Example Labs",
  role: "admin",
  items: [
    { ...exampleCandidate.interviews.interviews[0]!, applicationId: "a1", jobId: "j1", candidate: "Priya Nair", job: "SOC Analyst L1", day: "2026-10-14", assigned: false },
    {
      ...exampleCandidate.interviews.interviews[0]!,
      id: "iv2",
      when: "Thu 15 Oct, 17:00",
      range: "17:00 to 18:00",
      minutes: 60,
      status: "proposed",
      phoneShared: false,
      applicationId: "a4",
      jobId: "j1",
      candidate: "Ananya Ghosh",
      job: "SOC Analyst L1",
      day: "2026-10-15",
      assigned: true,
    },
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
    phoneShared: true,
    interviews: [
      { id: "iv0", round: "team", day: "2026-10-09", when: "Fri 9 Oct, 15:00", range: "15:00 to 15:30", minutes: 30, status: "done", canRespond: false, phoneShared: false },
      { id: "iv1", round: "team", day: "2026-10-14", when: "Wed 14 Oct, 11:00", range: "11:00 to 11:45", minutes: 45, status: "accepted", canRespond: false, phoneShared: true },
    ],
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
    phoneShared: false,
    interviews: [{ id: "iv3", round: "team", day: "2026-10-19", when: "Mon 19 Oct, 16:00", range: "16:00 to 16:30", minutes: 30, status: "proposed", canRespond: true, phoneShared: false }],
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
    phoneShared: false,
    interviews: [],
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
  canAskTimes: true,
  messages: [
    { by: "system", who: "", text: "Applied on CareerMetro." },
    { by: "team", who: "Rahul Menon", text: "Thanks for applying, Priya. Could you tell us about the Splunk dashboards on your resume?", at: "Mon 11:02" },
    { by: "me", who: "You", question: true, text: "Which SIEM tools have you used on shift work?", at: "Mon 11:05" },
    { by: "candidate", who: "Priya Nair", text: "Happy to. I built three dashboards for branch login alerts.", at: "Tue 10:12" },
  ],
};

/** A chat with an answered "Ask for times" card (build step 6). */
export const exampleTimesChat: CompanyChatView = {
  ...exampleCompanyChat,
  messages: [
    ...exampleCompanyChat.messages,
    {
      by: "me",
      who: "You",
      text: "Which times work for you between Wed 14 Oct and Tue 20 Oct? Pick the ones that suit you; we only see the times you pick.",
      at: "Mon 12 Oct",
      times: { offered: ["Wed 14 Oct, 11:00", "Thu 15 Oct, 10:00", "Fri 16 Oct, 15:00"] },
    },
    { by: "candidate", who: "Priya Nair", text: "I've offered 3 times: Wed 14 Oct, 11:00 · Thu 15 Oct, 10:00 · Fri 16 Oct, 15:00.", at: "Mon 12 Oct" },
  ],
};

/** The candidate's side of a real "Ask for times" (build step 6): five weekdays, two slots too soon to offer. */
export const exampleInboxAsk: InboxMessage = {
  id: "ask1",
  by: "them",
  who: "Meera Iyer",
  type: "times",
  text: "Which times work for you between Wed 14 Oct and Tue 20 Oct? Pick the ones that suit you; we only see the times you pick.",
  at: "Mon 12 Oct",
  ask: {
    messageId: "ask1",
    days: [
      { day: "2026-10-14", label: ["Wed", "14 Oct"] },
      { day: "2026-10-15", label: ["Thu", "15 Oct"] },
      { day: "2026-10-16", label: ["Fri", "16 Oct"] },
      { day: "2026-10-19", label: ["Mon", "19 Oct"] },
      { day: "2026-10-20", label: ["Tue", "20 Oct"] },
    ],
    times: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"],
    unavailable: ["2026-10-14T10:00", "2026-10-14T11:00"],
    offered: null,
    open: true,
  },
};

/** Corporate Overview for the example admin (build step 7): counts only. */
export const exampleOverview: CompanyOverviewView = {
  role: "admin",
  assignedOnly: false,
  openJobs: 1,
  newApplications: 4,
  interviewsToday: 1,
  interviewsThisWeek: 3,
  unreadChats: 2,
  lanes: { applied: 3, shortlisted: 2, ai: 0, team: 1, offer: 0, not_this_time: 1 },
  jobs: [
    { id: "j1", title: "SOC Analyst L1", city: "Pune", status: "open", lanes: { applied: 3, shortlisted: 2, ai: 0, team: 1, offer: 0, not_this_time: 1 }, total: 7 },
    { id: "j3", title: "Freelance QA tester", city: "Remote", status: "paused", lanes: { applied: 0, shortlisted: 0, ai: 0, team: 0, offer: 0, not_this_time: 0 }, total: 0 },
  ],
};

/** An Interviewer's Overview: only the candidates they interview. */
export const exampleInterviewerOverview: CompanyOverviewView = {
  ...exampleOverview,
  role: "interviewer",
  assignedOnly: true,
  newApplications: 0,
  interviewsThisWeek: 1,
  unreadChats: 0,
  lanes: { applied: 0, shortlisted: 0, ai: 0, team: 1, offer: 0, not_this_time: 0 },
  jobs: [{ id: "j1", title: "SOC Analyst L1", city: "Pune", status: "open", lanes: { applied: 0, shortlisted: 0, ai: 0, team: 1, offer: 0, not_this_time: 0 }, total: 1 }],
};

/** The example company's audit (build step 7): ids and fixed actions, never a candidate's name or contact details. */
export const exampleAudit: CompanyAuditView = {
  company: "Example Labs",
  next: null,
  lines: [
    { id: "l1", at: "13 Oct 2026, 16:05", who: { kind: "member", name: "Rahul Menon", role: "hiring" }, action: "Cancelled an interview", on: { kind: "application", ref: "3f2a91c0", job: "SOC Analyst L1" } },
    { id: "l2", at: "13 Oct 2026, 15:40", who: { kind: "candidate" }, action: "Accepted an interview", on: { kind: "application", ref: "8b14d2e7", job: "SOC Analyst L1" } },
    { id: "l3", at: "13 Oct 2026, 15:30", who: { kind: "member", name: "Rahul Menon", role: "hiring" }, action: "Booked an interview", on: { kind: "application", ref: "8b14d2e7", job: "SOC Analyst L1" } },
    { id: "l4", at: "13 Oct 2026, 11:12", who: { kind: "member", name: "Meera Iyer", role: "admin" }, action: "Opened a candidate", on: { kind: "application", ref: "3f2a91c0", job: "SOC Analyst L1" } },
    { id: "l5", at: "12 Oct 2026, 18:20", who: { kind: "member", name: "Meera Iyer", role: "admin" }, action: "Removed a role", on: { kind: "member", name: "Farhan Shaikh", role: "hiring" } },
    { id: "l6", at: "12 Oct 2026, 10:02", who: { kind: "member", name: "Meera Iyer", role: "admin" }, action: "Gave a role by work email", on: { kind: "invite", role: "interviewer", domain: "example-labs.test" } },
    { id: "l7", at: "12 Oct 2026, 09:58", who: { kind: "former" }, action: "Opened a job", on: { kind: "job", ref: "5c0e7a11", title: "SOC Analyst L1" } },
  ],
};
