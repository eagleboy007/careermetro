import type { CorporateHomeView, JobFormData, PostedJobView, SignupDetails } from "@/lib/corporate/types";

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
      { id: "j1", title: "SOC Analyst L1", roleTitle: "Cyber Security Analyst", city: "Pune", workType: "full_time", status: "open", live: false, createdOn: "2026-10-12", closedOn: null, ownerName: "Meera Iyer", myRole: "owner", canEdit: true, requiredCount: 6 },
      { id: "j2", title: "Data Analyst, payments", roleTitle: "Data Analyst", city: "Bengaluru", workType: "full_time", status: "draft", live: false, createdOn: "2026-10-13", closedOn: null, ownerName: "Rahul Menon", myRole: null, canEdit: true, requiredCount: 0 },
      { id: "j3", title: "Freelance QA tester", roleTitle: "QA Automation Engineer", city: "Remote", workType: "freelance", status: "paused", live: false, createdOn: "2026-10-12", closedOn: null, ownerName: "Meera Iyer", myRole: "owner", canEdit: true, requiredCount: 4 },
      { id: "j4", title: "Cloud Engineer", roleTitle: "Cloud Engineer", city: "Hyderabad", workType: "full_time", status: "closed", live: false, createdOn: "2026-10-12", closedOn: "2026-10-13", ownerName: "Meera Iyer", myRole: "owner", canEdit: false, requiredCount: 7 },
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
