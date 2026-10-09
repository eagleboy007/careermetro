import type { Departure, GoalsSummary, Ride, RideTask, RideWeek, SignalCheck, Streak, UserState } from "@/lib/schemas";

// Synthetic example data for the design page and the Today preview. Every person, company and number is made up.

export const exampleName = "Priya";
export const exampleRole = "Data Analyst";

export const exampleRide: Ride = {
  pitstop: 4,
  pitstopCount: 9,
  goalName: "SQL window functions",
  title: "This week is about your SQL window functions goal.",
  summary: "Two pitstops: learn it with the free Kaggle course (Pitstop 4, this week's tasks), then prove it (Pitstop 5) to fill the gap.",
  tasks: [
    { id: "t1", title: "Do the Advanced SQL lesson on analytic functions", detail: "Kaggle Learn · course", minutes: 25, done: false, locked: false },
    { id: "t2", title: "Rank the top 5 products per month in the sample sales table", detail: "Practice, part 1 of 3 · paste the query when done", minutes: 20, done: false, locked: false },
    { id: "t3", title: "Answer today's signal check", detail: "One question", minutes: 2, done: false, locked: true },
  ],
  weekTasksDone: 2,
  weekTasksTotal: 5,
};

export const exampleWeek: RideWeek = [
  { label: "M", rode: true, today: false },
  { label: "T", rode: true, today: false },
  { label: "W", rode: true, today: false },
  { label: "T", rode: false, today: true },
  { label: "F", rode: false, today: false },
  { label: "S", rode: false, today: false },
  { label: "S", rode: false, today: false },
];

export const exampleStreak: Streak = { days: 11, todayCounted: false };

export const exampleDepartures: Departure[] = [
  { id: "d1", role: "MIS executive", where: "Pune · 18 posts", gapsLeft: 0, gaps: [], note: "No required gaps. Your resume already fits these." },
  {
    id: "d2",
    role: "Junior data analyst",
    where: "Pune · 12 posts",
    gapsLeft: 2,
    gaps: [
      { status: "missing", name: "SQL window functions" },
      { status: "weak", name: "Power BI" },
    ],
    note: "Two gaps between you and these.",
  },
  {
    id: "d3",
    role: "Data analyst",
    where: "Bengaluru · 27 posts",
    gapsLeft: 3,
    gaps: [
      { status: "missing", name: "SQL window functions" },
      { status: "weak", name: "Power BI" },
      { status: "weak", name: "Python (pandas)" },
    ],
    note: "Three gaps. This is your destination.",
  },
];

export const exampleGoals: GoalsSummary = {
  track: "BI and reporting",
  goals: [
    {
      id: "g1",
      name: "SQL window functions",
      status: "missing",
      evidence: "Your resume shows joins but no window functions. Today's ride is on it.",
      quote: "Wrote SQL queries for weekly sales reports",
      pitstops: [
        { number: 4, kind: "learn", title: "Learn: Kaggle Advanced SQL", note: "2 of 5 tasks", state: "now" },
        { number: 5, kind: "prove", title: "Prove: skill check, certificate or work", note: "fills the gap", state: "ahead" },
      ],
      suggestion: null,
    },
    {
      id: "g2",
      name: "Power BI",
      status: "weak",
      evidence: "Listed under skills, but no project or job uses it. Since it is on your resume, the goal starts with a prove pitstop.",
      quote: null,
      pitstops: [{ number: 6, kind: "prove", title: "Prove: a published dashboard or skill check", note: "fills the gap", state: "ahead" }],
      suggestion: { title: "Suggested pitstop: Power BI learning path", detail: "Add a learn pitstop from Microsoft Learn first, about 6 hours." },
    },
    {
      id: "g3",
      name: "Python (pandas)",
      status: "weak",
      evidence: "Last used in your 2021 role.",
      quote: "Cleaned survey data with pandas",
      pitstops: [
        { number: 7, kind: "learn", title: "Learn: Kaggle Pandas", note: "about 4 h", state: "ahead" },
        { number: 8, kind: "prove", title: "Prove: skill check or a notebook you wrote", note: "fills the gap", state: "ahead" },
      ],
      suggestion: null,
    },
  ],
  moreCount: 1,
  metThisMonth: ["Excel", "Data cleaning"],
};

export const exampleFirstTally = { skillsFound: 9, gaps: 5, goals: 5, boardable: 1 };

export const USER_STATE_LABELS: Record<UserState, string> = {
  no_resume: "No resume",
  first: "First sign-up",
  returning: "Returning",
};

export const exampleFirstTasks: RideTask[] = [
  { id: "f1", title: "Read what window functions do, in plain words", detail: "PostgreSQL docs · article", minutes: 15, done: false, locked: false },
  { id: "f2", title: "List 3 reports at work that rank or compare rows", detail: "Proof task, part 1 · two lines each", minutes: 15, done: false, locked: false },
];

export const exampleSignalCheck: SignalCheck = {
  skillName: "SQL window functions",
  status: "missing",
  question: "You need each product's sales next to its rank within its month, without losing any rows. Which do you use?",
  options: [
    { key: "A", label: "GROUP BY month, product", detail: "aggregate" },
    { key: "B", label: "RANK() OVER (PARTITION BY month ORDER BY sales DESC)", detail: "window function" },
    { key: "C", label: "A self join on month", detail: "join" },
    { key: "D", label: "ORDER BY month, sales DESC", detail: "sort" },
  ],
  correctKey: "B",
  explanation: "A window function ranks rows within each month and keeps every row. GROUP BY would collapse them into one row per group.",
  from: "From your SQL window functions goal · warms you up for Pitstop 5",
};
