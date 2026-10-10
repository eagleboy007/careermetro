import { story, type MeProfile, type Profile, type Story } from "@/lib/schemas";
import { exampleMapLine } from "@/lib/map/fixtures";
import { meFromProfile } from "./build";

/* A synthetic profile for Priya on the Data Analyst line, for the design page and the preview. Companies are made up. */

export const exampleMeResume: Profile = {
  headline: "MIS Executive",
  totalYearsExperience: 2.3,
  roles: [
    {
      title: "MIS Executive",
      employer: "Konkan Co-operative Bank",
      start: "2024-06",
      end: null,
      highlights: [
        "Built the weekly branch performance report for 3 branches in Excel",
        "Cut month-end reporting from 3 days to 1 with pivot tables and lookups",
        "Answered ad hoc data requests from the branch managers",
      ],
    },
    {
      title: "MIS Intern",
      employer: "Western Ghats Logistics",
      start: "2024-01",
      end: "2024-05",
      highlights: ["Kept the shipment tracker up to date for 4 depots", "Wrote SQL joins to match invoices with deliveries"],
    },
  ],
  skills: [
    { name: "Reporting", lastUsed: null, evidence: [] },
    { name: "Communication", lastUsed: null, evidence: [] },
  ],
  education: [
    { qualification: "B.Com", institution: "Savitribai Phule Pune University", year: "2020-2023" },
    { qualification: "Higher Secondary (Commerce)", institution: "Maharashtra State Board", year: "2020" },
  ],
  certifications: ["Google Data Analytics Certificate"],
};

const s = (x: Omit<Story, "hint" | "confirmed" | "fromGoal"> & Partial<Pick<Story, "hint" | "confirmed" | "fromGoal">>): Story =>
  story.parse({ hint: null, confirmed: false, fromGoal: false, ...x });

export const exampleStories: Story[] = [
  s({
    id: "s1",
    title: "Month-end reports in one day instead of three",
    where: "Konkan Co-operative Bank · 2024 to now",
    boxes: ["Ownership", "Delivering results"],
    situation: "Month-end branch reports took three days of copy and paste.",
    task: "Get them out faster without mistakes.",
    action: "Rebuilt the workbook with pivot tables and lookups, and wrote a one-page checklist.",
    result: "Reports go out in one day; no corrections in six months.",
    smart: ["S", "M", "A", "R", "T"],
    confirmed: true,
  }),
  s({
    id: "s2",
    title: "Matched 1,200 invoices with deliveries",
    where: "Western Ghats Logistics · internship 2024",
    boxes: ["Problem solving"],
    situation: "Invoices and deliveries lived in two systems that never agreed.",
    task: "Find the mismatches before the quarter closed.",
    action: "Exported both and wrote SQL joins to match them by order number and date.",
    result: "Found 37 mismatches worth ₹4.2 lakh in two weeks.",
    smart: ["S", "M", "A", "R", "T"],
    confirmed: true,
  }),
  s({
    id: "s3",
    title: "A branch report the managers ask for",
    where: "Konkan Co-operative Bank · 2025",
    boxes: ["Delivering results", "Working with others"],
    situation: "Branch managers each kept their own numbers.",
    task: "Give them one weekly view they trust.",
    action: "Agreed the five numbers with them and built one report.",
    result: "All three branches use it every Monday.",
    smart: ["S", "A", "T"],
    hint: "Add a number to make it Measurable, such as how much time it saved.",
  }),
  s({
    id: "s4",
    title: "Learning SQL window functions on real sales data",
    where: "SQL window functions goal · Oct 2026",
    boxes: ["Learning"],
    situation: "No SQL beyond joins at work, but most analyst posts ask for window functions.",
    task: "Learn them well enough to rank and compare.",
    action: "Kaggle's Advanced SQL, then running totals on a public sales dataset.",
    result: "Wrote 6 working queries on the practice data.",
    smart: ["S", "M", "A", "T"],
    hint: "Fills in when you prove this goal. Then it is Relevant to every analyst role.",
    fromGoal: true,
  }),
];

const built = meFromProfile({
  name: "Priya Nair",
  profile: exampleMeResume,
  analysis: {
    roleSlug: "data-analyst",
    gaps: [
      { skillId: "sql-window", skillName: "SQL window functions", status: "missing", resumeQuote: null, requirement: "r", explanation: "e" },
      { skillId: "power-bi", skillName: "Power BI", status: "weak", resumeQuote: null, requirement: "r", explanation: "e" },
      { skillId: "python", skillName: "Python with pandas", status: "weak", resumeQuote: null, requirement: "r", explanation: "e" },
      { skillId: "data-storytelling", skillName: "Data storytelling", status: "weak", resumeQuote: null, requirement: "r", explanation: "e" },
    ],
    metSkillIds: ["excel", "sql", "statistics"],
    niceToHave: [],
    readiness: { headline: "h", explanation: "e", estimatedHours: 40 },
  },
  line: exampleMapLine,
  skillName: (id) => ({ excel: "Excel pivot tables", sql: "SQL joins", statistics: "Statistics basics" })[id] ?? id,
  joinedAt: new Date("2026-09-02T00:00:00Z"),
  resumeReadAt: new Date("2026-09-02T00:00:00Z"),
  now: new Date("2026-10-10T00:00:00Z"),
});

export const exampleMe: MeProfile = {
  ...built,
  stats: [...built.stats.slice(0, 2), { value: "3", label: "goals proved", private: false }],
  interests: ["Data", "Cricket stats", "Public speaking", "Marathi theatre"],
  stories: exampleStories,
  proofs: [
    { title: "Pivot table that answers five branch questions", detail: "Excel pivot tables goal · 9 Sep · public" },
    { title: "Three joins on a public orders dataset", detail: "SQL joins goal · 18 Sep · public" },
    { title: "Mean, median and spread of one month's loans", detail: "Statistics basics goal · 29 Sep · connections only" },
  ],
  certifications: [{ name: "Google Data Analytics Certificate", verified: true }],
};
