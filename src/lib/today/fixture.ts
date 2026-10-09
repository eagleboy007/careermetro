import type { Goal, TodayView, UserState } from "@/lib/schemas/today";

/**
 * Made-up data for the Today screen, matching prototype v28. Priya Nair and every company here are fictional.
 * Used on /design and on the /today preview until the real data lands (handoff build order, PRs 4 to 6).
 */

const goals: Goal[] = [
  {
    id: "siem",
    skillName: "SIEM (Splunk or Sentinel)",
    status: "missing",
    evidence: "No SIEM tool appears in your resume. Today's ride is on it.",
    resumeQuote: null,
    pitstops: [
      { number: 4, kind: "learn", label: "Learn: free Splunk course", state: "now", note: "2 of 5 tasks" },
      { number: 5, kind: "prove", label: "Prove: skill check, certificate or work", state: "ahead", note: "fills the gap" },
    ],
    suggestedPitstop: null,
    source: "gap",
  },
  {
    id: "threat-detection",
    skillName: "Threat detection",
    status: "weak",
    evidence: "You name no detection techniques.",
    resumeQuote: "Monitored security alerts for 40 users",
    pitstops: [
      { number: 6, kind: "learn", label: "Learn: MITRE ATT&CK", state: "ahead", note: "about 4 h" },
      { number: 7, kind: "prove", label: "Prove: skill check or certificate", state: "ahead", note: "fills the gap" },
    ],
    suggestedPitstop: { title: "Blue team labs", why: "Hands-on detection practice before you prove it." },
    source: "gap",
  },
  {
    id: "python",
    skillName: "Python scripting",
    status: "weak",
    evidence: "Listed under skills; no project or job uses it. Since it is on your resume, the goal starts at prove.",
    resumeQuote: null,
    pitstops: [{ number: 8, kind: "prove", label: "Prove: skill check or a script you wrote", state: "ahead", note: "fills the gap" }],
    suggestedPitstop: { title: "Python for logs", why: "Add a learn pitstop first if you feel rusty." },
    source: "gap",
  },
  {
    id: "aws-security",
    skillName: "AWS security",
    status: "missing",
    evidence: "Cloud basics (Pitstop 3) covered the ground, so this goal is one prove pitstop: IAM and logging.",
    resumeQuote: null,
    pitstops: [{ number: 9, kind: "prove", label: "Prove: AWS certification or IAM skill check", state: "ahead", note: "fills the gap" }],
    suggestedPitstop: null,
    source: "gap",
  },
];

const departures: TodayView["departures"] = [
  { id: "it-support-security", role: "IT support + security", city: "Pune", posts: 22, gaps: [], isDestination: false },
  {
    id: "soc-l1",
    role: "SOC analyst L1",
    city: "Pune",
    posts: 14,
    gaps: [
      { skillName: "SIEM", status: "missing" },
      { skillName: "Threat detection", status: "weak" },
    ],
    isDestination: false,
  },
  {
    id: "security-analyst",
    role: "Security analyst",
    city: "Bengaluru",
    posts: 31,
    gaps: [
      { skillName: "SIEM", status: "missing" },
      { skillName: "Python", status: "weak" },
      { skillName: "AWS security", status: "missing" },
    ],
    isDestination: false,
  },
  {
    id: "cyber-security-analyst",
    role: "Cyber security analyst",
    city: "Hyderabad",
    posts: 9,
    gaps: [
      { skillName: "SIEM", status: "missing" },
      { skillName: "Threat detection", status: "weak" },
      { skillName: "Python", status: "weak" },
      { skillName: "AWS security", status: "missing" },
    ],
    isDestination: true,
  },
];

const LINE_STOPS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "Practice", "Match"];

const base: Omit<TodayView, "state"> = {
  firstName: "Priya",
  initials: "PN",
  destination: "Cyber Security Analyst",
  track: "SOC and detection",
  jobSearch: true,
  // A Thursday, as in the prototype.
  today: "2026-10-08",
  rideDays: [
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
  ],
  ride: {
    goalName: "SIEM",
    pitstop: { number: 4, total: 11, kind: "learn" },
    tasks: [
      { id: "t1", title: "Watch Splunk Fundamentals, module 2", source: "Free Splunk courses · video", minutes: 25, done: false, kind: "prep" },
      {
        id: "t2",
        title: "Write your first search on the BOTS v3 data",
        source: "Practice, part 1 of 3 · paste the search when done",
        minutes: 20,
        done: false,
        kind: "prep",
      },
      { id: "t3", title: "Answer today's signal check", source: "One question, just below", minutes: 2, done: false, kind: "signal_check" },
    ],
    weekTotal: 5,
    doneBeforeToday: 2,
    lineStops: LINE_STOPS,
    currentStopIndex: 3,
  },
  firstSignup: null,
  signalCheck: {
    skillName: "Threat detection",
    status: "weak",
    question:
      "Your SIEM shows 46 failed logins to one account from 203.0.113.7 in two minutes, then one success. Which MITRE ATT&CK technique fits best?",
    options: [
      { key: "A", label: "Brute Force", detail: "T1110" },
      { key: "B", label: "Phishing", detail: "T1566" },
      { key: "C", label: "Network Service Discovery", detail: "T1046" },
      { key: "D", label: "Command and Scripting Interpreter", detail: "T1059" },
    ],
    correctKey: "A",
    explanation:
      "Many failed logins, then a success from one source, is password guessing: T1110. Next, check what the account did after it logged in (T1078 Valid Accounts).",
    from: "From your threat detection goal · warms you up for Pitstop 6",
  },
  goals,
  moreGoals: ["Incident response", "Alert triage"],
  goalsMetThisMonth: ["Application security", "Vulnerability management"],
  suggestedGoal: {
    skillName: "Networking basics",
    why: "Wireshark shows up in 6 of the 14 SOC Analyst L1 posts in Pune, and it is not on your line yet.",
  },
  departures,
  ridersOnGoal: 7,
};

/** The Today view for one user state. */
export function todayFixture(state: UserState): TodayView {
  if (state === "returning") return { state, ...base };
  if (state === "first_signup") {
    return {
      ...base,
      state,
      rideDays: [],
      ride: {
        goalName: "Application security",
        pitstop: { number: 1, total: 11, kind: "learn" },
        tasks: [
          { id: "f1", title: "Read the OWASP Top 10 in plain words", source: "OWASP official docs · article", minutes: 15, done: false, kind: "prep" },
          { id: "f2", title: "Pick 3 of the risks you have seen at work", source: "Proof task, part 1 · two lines each", minutes: 15, done: false, kind: "prep" },
        ],
        weekTotal: 5,
        doneBeforeToday: 0,
        lineStops: LINE_STOPS,
        currentStopIndex: 0,
      },
      firstSignup: { skillsFound: 14, gaps: 11, goals: 9, rolesBoardingNow: 1, lineHours: 68 },
      signalCheck: null,
      goalsMetThisMonth: [],
      suggestedGoal: null,
      goals: goals.map((g) => ({ ...g, pitstops: g.pitstops.map((p) => ({ ...p, state: "ahead" as const })) })),
      ridersOnGoal: 9,
    };
  }
  return {
    ...base,
    state,
    track: null,
    rideDays: [],
    ride: null,
    firstSignup: null,
    signalCheck: null,
    goals: [],
    moreGoals: [],
    goalsMetThisMonth: [],
    suggestedGoal: null,
    ridersOnGoal: 0,
  };
}
