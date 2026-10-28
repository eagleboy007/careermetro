import { postFit } from "@/lib/my-jobs/view";
import { jobPost, type JobPost, type JobPostInput, type MyJobView } from "@/lib/schemas";

/*
 * Synthetic Departures for the design page and the preview: Priya's Data Analyst line (goals in order: SQL window
 * functions, Power BI, Python with pandas, Data storytelling). Companies are made up. The analyst roles name the Data
 * Analyst bank for their interview prep; the MIS, trainer and freelance roles have no bank role yet.
 */
const job = (j: JobPostInput): JobPost => jobPost.parse(j);

export const exampleJobs: JobPost[] = [
  job({
    id: "j1",
    role: "MIS executive, finance reports",
    company: "Sahyadri Fintech",
    city: "Pune",
    experience: "0 to 2 years",
    posted: "2 days ago",
    gaps: [],
    have: ["Excel pivot tables", "SQL joins", "Reporting", "Communication"],
    goalsBefore: 0,
    why: "Every required skill in the post is on your resume.",
  }),
  job({
    id: "j2",
    role: "Junior data analyst",
    roleSlug: "data-analyst",
    company: "Kavach Retail Labs",
    city: "Pune",
    experience: "0 to 3 years",
    posted: "today",
    gaps: [
      { status: "missing", name: "SQL window functions" },
      { status: "weak", name: "Power BI" },
    ],
    have: ["Excel pivot tables", "SQL joins", "Statistics basics"],
    goalsBefore: 2,
    why: "About 3 weeks at 5 hours a week. You can still apply now.",
  }),
  job({
    id: "j3",
    role: "Reporting analyst",
    roleSlug: "data-analyst",
    company: "Indus Health Systems",
    city: "Remote",
    experience: "1 to 3 years",
    posted: "4 days ago",
    gaps: [
      { status: "missing", name: "SQL window functions" },
      { status: "weak", name: "Power BI" },
    ],
    have: ["Excel pivot tables", "Reporting", "SQL joins"],
    goalsBefore: 2,
    why: "Same two gaps as most junior analyst roles. Your ride this week works toward the first.",
  }),
  job({
    id: "j4",
    role: "Data analyst",
    roleSlug: "data-analyst",
    company: "Nimbus Retail Tech",
    city: "Bengaluru",
    experience: "2 to 4 years",
    posted: "1 week ago",
    gaps: [
      { status: "missing", name: "SQL window functions" },
      { status: "weak", name: "Power BI" },
      { status: "weak", name: "Python with pandas" },
    ],
    have: ["Excel pivot tables", "SQL joins"],
    goalsBefore: 3,
    why: "About 7 weeks. Save it and we tell you when it is one gap away.",
  }),
  job({
    id: "j5",
    role: "Data analyst, supply chain",
    roleSlug: "data-analyst",
    company: "Garuda Logistics",
    city: "Hyderabad",
    experience: "2 to 5 years",
    posted: "3 days ago",
    gaps: [
      { status: "missing", name: "SQL window functions" },
      { status: "weak", name: "Power BI" },
      { status: "weak", name: "Python with pandas" },
      { status: "weak", name: "Data storytelling" },
    ],
    have: ["Excel pivot tables", "Statistics basics"],
    goalsBefore: 4,
    destination: true,
    why: "This is the role your line is built for.",
  }),
  job({
    id: "j6",
    role: "MIS analyst",
    company: "Deccan Data Services",
    city: "Pune",
    experience: "0 to 2 years",
    posted: "5 days ago",
    gaps: [],
    have: ["Excel pivot tables", "SQL joins", "Communication"],
    goalsBefore: 0,
    why: "No required gaps. One nice-to-have (Power BI) is a goal on your line.",
  }),
  job({
    id: "j7",
    role: "Excel trainer for small businesses",
    company: "Konkan Skills Academy",
    city: "Pune",
    workType: "Part time",
    hours: "20 h a week, evenings",
    experience: "1 to 3 years",
    posted: "yesterday",
    gaps: [],
    have: ["Excel pivot tables", "Communication", "Reporting"],
    goalsBefore: 0,
    why: "Evenings only, so it fits around your ride. Your Excel and reporting cover what they ask for.",
  }),
  job({
    id: "j8",
    role: "Sales dashboard clean-up for a clinic chain",
    company: "Medisetu Clinics",
    city: "Remote",
    workType: "Freelance",
    hours: "2-week project, fixed fee",
    experience: "Project",
    posted: "3 days ago",
    gaps: [],
    have: ["Excel pivot tables", "Reporting"],
    goalsBefore: 0,
    why: "A two-week project that matches your reporting work. Once the client confirms the work, it can count as work proof on your profile.",
  }),
  job({
    id: "j9",
    role: "Weekend data analyst",
    roleSlug: "data-analyst",
    company: "Kavach Retail Labs",
    city: "Pune",
    workType: "Part time",
    hours: "Weekends, 16 h a week",
    experience: "0 to 2 years",
    posted: "4 days ago",
    gaps: [{ status: "missing", name: "SQL window functions" }],
    have: ["Excel pivot tables", "SQL joins"],
    goalsBefore: 1,
    why: "Weekend shifts only. Prove SQL window functions and this one boards.",
  }),
];

/** The example person's own lists: one saved role, two applications with how far each has gone (1 = Applied). */
export const exampleSaved = ["j4"];
export const exampleApplied: [string, number][] = [
  ["j1", 3],
  ["j6", 2],
];

/** Feed rows of the example My jobs: the saved and applied example roles. */
const feedMine = (id: string, status: MyJobView["status"], over: Partial<MyJobView> = {}): MyJobView => {
  const j = exampleJobs.find((x) => x.id === id)!;
  return {
    key: `post:${id}`,
    ref: { kind: "post", postId: id },
    company: j.company,
    title: j.role,
    city: j.city,
    source: "board",
    url: j.applyUrl,
    status,
    savedAt: status === "saved" ? "2026-10-18T06:30:00.000Z" : null,
    appliedAt: status === "saved" ? null : "2026-10-20T06:30:00.000Z",
    closedAt: null,
    interviewAt: null,
    note: null,
    updatedAt: "2026-10-24T06:30:00.000Z",
    postClosed: j.closed,
    hasDescription: false,
    fit: postFit(j, true),
    ...over,
  };
};

/**
 * The example person's My jobs (handoff 12m, prototype v48): the example roles they saved and applied to, and three jobs
 * they added from other sites (one with a private note, one closed). Made-up companies; the links go nowhere real.
 */
export const exampleMine: MyJobView[] = [
  {
    key: "check:00000000-0000-4000-8000-0000000000a1",
    ref: { kind: "check", checkId: "00000000-0000-4000-8000-0000000000a1" },
    company: "Example Analytics Pvt Ltd",
    title: "Data analyst",
    city: "Pune",
    source: "you",
    url: "https://careers.example.com/data-analyst",
    status: "interview",
    savedAt: "2026-10-19T06:30:00.000Z",
    appliedAt: "2026-10-21T06:30:00.000Z",
    closedAt: null,
    // Fri 30 Oct, 10:30 IST.
    interviewAt: "2026-10-30T05:00:00.000Z",
    note: "Spoke to the hiring lead. Round 1 is a SQL test, then a case study on store sales.",
    updatedAt: "2026-10-27T06:30:00.000Z",
    postClosed: false,
    hasDescription: true,
    fit: { have: 3, open: [{ status: "weak", name: "SQL window functions" }, { status: "missing", name: "Power BI" }], only: ["Alteryx"] },
  },
  feedMine("j1", "interview", { updatedAt: "2026-10-26T06:30:00.000Z", note: "Round 1 is a 30-minute call with the team lead." }),
  {
    key: "check:00000000-0000-4000-8000-0000000000a2",
    ref: { kind: "check", checkId: "00000000-0000-4000-8000-0000000000a2" },
    company: "Orbit Freight",
    title: "Supply chain analyst",
    city: null,
    source: "you",
    url: null,
    status: "saved",
    savedAt: "2026-10-27T06:30:00.000Z",
    appliedAt: null,
    closedAt: null,
    interviewAt: null,
    note: null,
    updatedAt: "2026-10-25T06:30:00.000Z",
    postClosed: false,
    hasDescription: true,
    fit: { have: 4, open: [], only: ["SAP MM"] },
  },
  feedMine("j6", "heard"),
  feedMine("j4", "saved", { updatedAt: "2026-10-18T06:30:00.000Z" }),
  {
    key: "check:00000000-0000-4000-8000-0000000000a3",
    ref: { kind: "check", checkId: "00000000-0000-4000-8000-0000000000a3" },
    company: "Lotus Bank",
    title: "MIS analyst, branch reports",
    city: "Mumbai",
    source: "board",
    url: "https://jobs.example.com/lotus-bank/mis",
    status: "no",
    savedAt: "2026-10-10T06:30:00.000Z",
    appliedAt: "2026-10-12T06:30:00.000Z",
    closedAt: "2026-10-24T06:30:00.000Z",
    interviewAt: null,
    note: null,
    updatedAt: "2026-10-12T06:30:00.000Z",
    postClosed: false,
    hasDescription: true,
    fit: { have: 2, open: [{ status: "missing", name: "Power BI" }], only: [] },
  },
];

/*
 * Live Departures as a signed-in person sees them (docs/plans/departures-live-plan.md), for /design: a feed role with
 * its link and fit, one that closed on its company's board (still in Saved and Applied, no Apply), and one whose post
 * names too few skills we know. Made-up companies; the links go nowhere real.
 */
export const exampleLiveJobs: JobPost[] = [
  job({
    id: "l1",
    role: "Junior data analyst",
    roleSlug: "data-analyst",
    company: "Example Labs",
    city: "Pune",
    experience: "2 to 4 years",
    posted: "today",
    gaps: [{ status: "missing", name: "Statistics" }],
    have: ["SQL", "Excel"],
    goalsBefore: 1,
    destination: true,
    why: "The role your line is built for. It is a goal on your line.",
    applyUrl: "https://jobs.example.com/example-labs/l1",
  }),
  job({
    id: "l2",
    role: "Reporting analyst",
    roleSlug: "data-analyst",
    company: "Examplecart",
    city: "Remote",
    experience: "",
    posted: "12 days ago",
    gaps: [
      { status: "missing", name: "Statistics" },
      { status: "weak", name: "Power BI" },
    ],
    have: ["SQL", "Excel"],
    goalsBefore: 2,
    why: "One of them is a goal on your line. You can still apply now.",
    applyUrl: "https://jobs.example.com/examplecart/l2",
    closed: true,
  }),
  job({
    id: "l3",
    role: "Office coordinator",
    company: "Example Works",
    city: "Bengaluru",
    experience: "",
    posted: "3 days ago",
    gaps: [],
    have: [],
    goalsBefore: 0,
    why: "",
    applyUrl: "https://jobs.example.com/example-works/l3",
    fitNote: "Fit not shown: the post names too few skills we know.",
  }),
];
export const exampleLiveSaved = ["l2"];
export const exampleLiveApplied: [string, number][] = [["l2", 2]];
