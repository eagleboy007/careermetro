import type { JobCheckRowView } from "@/components/admin/job-check-review";
import type { AdminCompanyView } from "@/lib/corporate/types";
import type { LibraryAdminView } from "@/lib/schemas";
import type { HeldProofView, HiddenMessageView, ReportReviewView, SuspendedAccountView } from "@/lib/schemas/admin";
import type { AppealView, HiddenJunctionView } from "@/lib/schemas/junction";

/** Example rows of the company review list for /design. Synthetic companies on reserved example domains. */
export const exampleReviewCompanies: AdminCompanyView[] = [
  {
    id: "7a0f3c1e-2b4d-4e6f-8a1b-3c5d7e9f1a20",
    name: "Example Labs",
    type: "company",
    domain: "example-labs.test",
    website: "https://www.example-labs.test",
    websiteOnOtherDomain: false,
    city: "Pune",
    size: "51 to 200",
    createdOn: "2026-10-12",
    members: 2,
    admins: 1,
    noAdmin: false,
    status: "pending",
  },
  {
    id: "8b1e4d2f-3c5e-4f70-9b2c-4d6e8f0a2b31",
    name: "Sample Institute of Technology",
    type: "college",
    domain: "students.sample-institute.test",
    website: "https://sample-college.test",
    websiteOnOtherDomain: true,
    city: "Chennai",
    size: "More than 1,000",
    createdOn: "2026-10-11",
    members: 1,
    admins: 1,
    noAdmin: false,
    status: "pending",
  },
  {
    id: "9c2f5e30-4d6f-4081-8c3d-5e7f9a1b3c42",
    name: "Demo Payments",
    type: "company",
    domain: "demo-payments.test",
    website: null,
    websiteOnOtherDomain: false,
    city: null,
    size: "11 to 50",
    createdOn: "2026-10-09",
    members: 0,
    admins: 0,
    noAdmin: true,
    status: "suspended",
  },
];

/** Example rows of the held-proof review (/admin/proofs) for /design. Synthetic people and badge ids. */
export const exampleHeldProofs: HeldProofView[] = [
  {
    id: "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
    certificate: "AWS Certified Cloud Practitioner",
    issuer: "Amazon Web Services",
    reason: "badge_reused",
    reasonText: "Its Credly badge is already verified on another account",
    submittedOn: "2026-10-12",
    person: "Priya S.",
    others: 1,
    badgeUrl: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-0000000000aa",
  },
  {
    id: "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b",
    certificate: "Microsoft Certified: Azure Fundamentals",
    issuer: "Microsoft",
    reason: "credential_reused",
    reasonText: "Its credential id was already used on another account",
    submittedOn: "2026-10-11",
    person: "Ravi K.",
    others: 2,
    badgeUrl: null,
  },
];

/** The time /design reads the example reports at, so one deadline shows as passed. */
export const exampleReportsNow = "2026-10-15T09:00:00.000Z";

/** Example rows of the report review (/admin/reports) for /design. Synthetic people and companies. */
export const exampleReports: ReportReviewView[] = [
  {
    id: "4e3d2c1b-0a9f-4e8d-9c7b-6a5f4e3d2c1b",
    reason: "Asked for money, an OTP or bank details",
    what: "A message",
    reportedAt: "2026-10-12T05:10:00.000Z",
    acknowledgedAt: "2026-10-12T09:00:00.000Z",
    acknowledgeBy: "2026-10-13T05:10:00.000Z",
    decideBy: "2026-10-15T05:10:00.000Z",
    reporter: "Asha V.",
    note: "They asked me to pay a fee before the interview.",
    context: { label: "Message from Hari M. at Example Labs", text: "Please pay 5,000 to book your interview slot today." },
    message: {
      id: "8c7b6a5f-4e3d-4c2b-9a1f-0e9d8c7b6a51",
      hidden: { at: "2026-10-15T06:30:00.000Z", by: "Milin S.", reason: "Asked for money to book an interview." },
    },
    account: { id: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b62", name: "Hari M.", suspended: null, canSuspend: true },
  },
  {
    id: "5f4e3d2c-1b0a-4f9e-8d7c-6b5a4f3e2d1d",
    reason: "Sexual content, or pretending to be someone",
    what: "A person",
    reportedAt: "2026-10-15T07:40:00.000Z",
    acknowledgedAt: null,
    acknowledgeBy: "2026-10-16T07:40:00.000Z",
    decideBy: "2026-10-16T07:40:00.000Z",
    reporter: "Meera I.",
    note: null,
    context: { label: "Person: Ravi K.", text: null },
    message: null,
    account: {
      id: "0e9d8c7b-6a5f-4e4d-9c3b-2a1f0e9d8c73",
      name: "Ravi K.",
      suspended: { at: "2026-10-15T08:10:00.000Z", by: "Milin S.", reason: "Pretended to be a recruiter at another company." },
      canSuspend: true,
    },
  },
  {
    id: "6a5f4e3d-2c1b-4a0f-9e8d-7c6b5a4f3e2e",
    reason: "Fake job, scam or spam",
    what: "A job",
    reportedAt: "2026-10-15T08:20:00.000Z",
    acknowledgedAt: null,
    acknowledgeBy: "2026-10-16T08:20:00.000Z",
    decideBy: "2026-10-18T08:20:00.000Z",
    reporter: "A deleted account",
    note: null,
    context: { label: "Job at Demo Payments", text: "Data entry from home, earn 50,000 a week" },
    message: null,
    account: null,
  },
];

/** A report about a message, with nothing hidden or suspended yet, for /design's row on its own. */
export const exampleOpenMessageReport: ReportReviewView = {
  ...exampleReports[0]!,
  id: "1f0e9d8c-7b6a-4f5e-8d4c-3b2a1f0e9d84",
  message: { id: "2a1f0e9d-8c7b-4a6f-9e5d-4c3b2a1f0e95", hidden: null },
  account: { id: "3b2a1f0e-9d8c-4b7a-8f6e-5d4c3b2a1f06", name: "Hari M.", suspended: null, canSuspend: true },
};

/** Hidden messages and suspended accounts in force on /admin/reports, for /design. Synthetic people. */
export const exampleInForce: { messages: HiddenMessageView[]; accounts: SuspendedAccountView[] } = {
  messages: [
    {
      id: "8c7b6a5f-4e3d-4c2b-9a1f-0e9d8c7b6a51",
      label: "Message from Hari M. at Example Labs",
      text: "Please pay 5,000 to book your interview slot today.",
      hidden: { at: "2026-10-15T06:30:00.000Z", by: "Milin S.", reason: "Asked for money to book an interview." },
    },
  ],
  accounts: [
    {
      id: "0e9d8c7b-6a5f-4e4d-9c3b-2a1f0e9d8c73",
      name: "Ravi K.",
      suspended: { at: "2026-10-15T08:10:00.000Z", by: "Milin S.", reason: "Pretended to be a recruiter at another company." },
    },
  ],
};

/** A report about a Junction post, held for review after reports, for /design (FR-61). Synthetic people. */
export const exampleJunctionReport: ReportReviewView = {
  id: "7c6b5a4f-3e2d-4c1b-8a9f-0e1d2c3b4a5f",
  reason: "Asking for money, OTP or payment",
  what: "A post",
  reportedAt: "2026-10-15T06:00:00.000Z",
  acknowledgedAt: null,
  acknowledgeBy: "2026-10-16T06:00:00.000Z",
  decideBy: "2026-10-18T06:00:00.000Z",
  reporter: "Kavya N.",
  note: "Says pay a fee to get a referral.",
  context: { label: "Post by Arjun P.", text: "Guaranteed referral at a top company\n\nSend 2,000 to my UPI and I will refer you this week." },
  message: null,
  account: { id: "8d7c6b5a-4f3e-4d2c-9b1a-0f1e2d3c4b5a", name: "Arjun P.", suspended: null, canSuspend: true },
  junction: { target: "post", id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f1e2d3c4b", status: "held", tags: ["Referrals"], upvotes: 2, comments: 1, hidden: null },
  held: true,
};

/** A hidden Junction comment in force on /admin/reports, with its removal record, for /design. Synthetic people. */
export const exampleHiddenJunction: HiddenJunctionView[] = [
  {
    id: "0f9e8d7c-6b5a-4f4e-9d3c-2b1a0f1e2d3c",
    what: "comment",
    label: "Comment by Arjun P.",
    title: null,
    text: "DM me your Aadhaar and I will fast-track you.",
    hidden: { at: "2026-10-14T10:00:00.000Z", by: "Neha R.", reason: "Asked for identity documents.", rule: "Someone's personal details (phone, address, documents)" },
    removalId: "1a0f9e8d-7c6b-4a5f-8e4d-3c2b1a0f1e2d",
    legalHold: false,
    purgeAfter: "2027-04-12T10:00:00.000Z",
  },
];

/** An open appeal on /admin/reports, for /design. Synthetic people. */
export const exampleAppeals: AppealView[] = [
  {
    id: "2b1a0f9e-8d7c-4b6a-9f5e-4d3c2b1a0f1e",
    removalId: "3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f",
    what: "post",
    label: "Post by Sana K.",
    title: "Free mock interviews this Saturday",
    text: "I run free mock interviews for SOC roles. Link to sign up in the comments.",
    rule: "Fake job, scam or spam",
    removedAt: "2026-10-12T08:00:00.000Z",
    removedByYou: true,
    note: "These are real and free. I have run them for a year with my college.",
    appealedAt: "2026-10-13T04:30:00.000Z",
    decideBy: "2026-10-28T04:30:00.000Z",
  },
];

/** Work-email checks waiting for review on /admin/companies, for /design. Made-up companies on reserved example domains. */
export const exampleJobChecks: JobCheckRowView[] = [
  { id: "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b01", employer: "Konkan Co-operative Bank", domain: "kcbank.example", checkedAt: "2026-10-14T05:20:00.000Z" },
  { id: "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b02", employer: "Western Ghats Logistics", domain: "wgl-group.example", checkedAt: "2026-10-15T09:45:00.000Z" },
];

/** Example Library review lists for /design: real catalog links, made-up reports and suggestions on example domains. */
export const exampleLibraryQueue: LibraryAdminView = {
  broken: [
    {
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      title: "OpenIntro Statistics (free textbook)",
      provider: "OpenIntro",
      url: "https://www.openintro.org/book/os/",
      counts: { broken: 2, not_free: 0, outdated: 1, other: 0 },
      firstReported: "2026-10-17",
      healthy: false,
      lastChecked: "2026-10-19",
      hidden: false,
    },
    {
      id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      title: "DAX reference",
      provider: "Microsoft Learn",
      url: "https://learn.microsoft.com/en-us/dax/",
      counts: { broken: 0, not_free: 0, outdated: 0, other: 0 },
      firstReported: null,
      healthy: true,
      lastChecked: null,
      hidden: true,
    },
  ],
  suggestions: [
    { id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", url: "https://learn.example.org/power-bi/intro", host: "learn.example.org", skill: "Power BI", sent: "2026-10-18" },
    { id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80", url: "https://videos.example.org/watch?v=stats101", host: "videos.example.org", skill: null, sent: "2026-10-19" },
  ],
};
