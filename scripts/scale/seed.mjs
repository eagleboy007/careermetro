// The scale check's seed (docs/scale-check.md): about 10,000 synthetic members with what a member collects over a few
// months (a resume and its gaps, goals, ride days, My jobs, Settings, Timetable marks and interests, connections and
// requests, a few chats and notifications, past weekly emails and digests), plus the shared rows they point at (open and
// closed feed posts, Timetable events, one feed run). Deterministic: a fixed-seed generator, so every run writes the
// same rows. Bulk multi-row inserts, never one request a row.
//
//   DATABASE_URL=postgres://... node scripts/scale/seed.mjs        (SCALE_MEMBERS=10000 by default)
//
// Run after `npm run db:migrate` and `npm run db:seed` (it reads the skills and role profiles those load). It removes an
// earlier copy first (scripts/scale/cleanup.mjs), so it can run twice. Local databases only. Every name, company, job,
// note, message and link is made up; links use example.com, emails the reserved .invalid domain. Counts only in the
// output: no text the seed writes is printed.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { cleanScale } from "./cleanup.mjs";
import { assertLocalDatabase, BOARD_PREFIX, EVENT_PREFIX, FEED_RUN_ID, memberEmail, rng, TIMED_MEMBERS } from "./common.mjs";

const MEMBERS = Number(process.env.SCALE_MEMBERS ?? 10_000);
const OPEN_POSTS = Number(process.env.SCALE_OPEN_POSTS ?? 6_000);
const CLOSED_POSTS = Number(process.env.SCALE_CLOSED_POSTS ?? 3_000);
const EVENTS = Number(process.env.SCALE_EVENTS ?? 1_200);
const R = rng(20_261_031);

const root = new URL("../../", import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.now();
const at = (msAgo) => new Date(now - msAgo);
const daysAgo = (d) => at(d * DAY);

/* Content the app reads ------------------------------------------------------------------------------------------ */

const skills = read("src/content/skills.json");
const skillName = new Map(skills.map((s) => [s.id, s.name]));
const roles = new Map(
  readdirSync(join(root, "src/content/roles"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => read(`src/content/roles/${f}`))
    .map((r) => [r.slug, r]),
);
const interestTopics = read("src/content/interest-topics.json");
const practiceQuestions = read("src/content/practice-questions.json");
const policyVersion = readFileSync(join(root, "src/lib/account/store.ts"), "utf8").match(/ACCOUNT_POLICY_VERSION = "([^"]+)"/)?.[1];
if (!policyVersion) throw new Error("ACCOUNT_POLICY_VERSION not found in src/lib/account/store.ts");

/** The roles members aim at, weighted roughly like the beta's sign-ups (data and software first). */
const ROLE_WEIGHTS = [
  ["data-analyst", 18],
  ["software-engineer", 10],
  ["java-backend-developer", 8],
  ["python-developer", 6],
  ["frontend-developer", 7],
  ["full-stack-developer", 7],
  ["data-scientist", 7],
  ["data-engineer", 5],
  ["devops-engineer", 5],
  ["cloud-engineer", 4],
  ["qa-automation-engineer", 5],
  ["business-analyst", 6],
  ["product-manager", 3],
  ["digital-marketing-executive", 3],
  ["financial-analyst", 3],
  ["cyber-security-analyst", 3],
].filter(([slug]) => roles.has(slug));
if (ROLE_WEIGHTS.length < 5) throw new Error("too few of the scale check's roles are in src/content/roles");
const roleTotal = ROLE_WEIGHTS.reduce((n, [, w]) => n + w, 0);
const pickRole = () => {
  let x = R.next() * roleTotal;
  for (const [slug, w] of ROLE_WEIGHTS) if ((x -= w) < 0) return roles.get(slug);
  return roles.get(ROLE_WEIGHTS[0][0]);
};
const required = (role) => role.skills.filter((s) => s.importance === "required" && skillName.has(s.skillId));
const nice = (role) => role.skills.filter((s) => s.importance !== "required" && skillName.has(s.skillId));

/** Cities from PERSON_CITIES, weighted toward where the beta's members live. */
const CITIES = [
  ["Bengaluru", 20],
  ["Pune", 12],
  ["Hyderabad", 12],
  ["Mumbai", 10],
  ["Chennai", 9],
  ["New Delhi", 6],
  ["Noida", 5],
  ["Gurugram", 5],
  ["Kolkata", 4],
  ["Ahmedabad", 4],
  ["Kochi", 3],
  ["Jaipur", 3],
  ["Indore", 2],
  ["Coimbatore", 2],
  ["Lucknow", 2],
  ["Chandigarh", 1],
];
const cityTotal = CITIES.reduce((n, [, w]) => n + w, 0);
const pickCity = () => {
  let x = R.next() * cityTotal;
  for (const [c, w] of CITIES) if ((x -= w) < 0) return c;
  return CITIES[0][0];
};

/* Made-up people and companies ------------------------------------------------------------------------------------ */

const FIRST = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Rohan", "Kabir",
  "Dhruv", "Karthik", "Pranav", "Nikhil", "Rahul", "Siddharth", "Varun", "Harsh", "Aanya", "Diya", "Ananya", "Saanvi",
  "Ishita", "Kavya", "Meera", "Priya", "Riya", "Sneha", "Pooja", "Neha", "Divya", "Lakshmi", "Shruti", "Tanvi", "Nandini",
  "Aditi", "Gayatri", "Swati", "Farhan", "Imran", "Zoya", "Sana", "Joseph", "Maria", "Gurpreet", "Harpreet", "Manoj", "Deepa",
];
const LAST = [
  "Sharma", "Verma", "Iyer", "Nair", "Reddy", "Rao", "Patel", "Shah", "Mehta", "Joshi", "Kulkarni", "Deshpande", "Gupta",
  "Agarwal", "Singh", "Kaur", "Das", "Banerjee", "Chatterjee", "Mukherjee", "Pillai", "Menon", "Krishnan", "Subramanian",
  "Naidu", "Chauhan", "Yadav", "Mishra", "Pandey", "Khan", "Ansari", "Fernandes", "D'Souza", "Gill", "Bhat", "Hegde",
];
const CO_A = ["Kaveri", "Ganga", "Sahyadri", "Nilgiri", "Indus", "Deccan", "Malabar", "Aravalli", "Konkan", "Vindhya", "Narmada", "Godavari"];
const CO_B = ["Analytics", "Softech", "Fintech", "Retail", "Logistics", "Health", "Systems", "Cloudworks", "Labs", "Commerce", "Digital", "Infotech"];
const CO_C = ["Pvt Ltd", "LLP", "Technologies", "Solutions", "India"];
const company = () => `${R.pick(CO_A)} ${R.pick(CO_B)} ${R.pick(CO_C)}`;
const INSTITUTES = ["Example Institute of Technology", "Sample College of Engineering", "Demo University", "Placeholder Institute of Management"];

/* Rows ------------------------------------------------------------------------------------------------------------ */

const rows = {
  users: [], consents: [], user_settings: [], user_plans: [], resumes: [], profiles: [], gap_analyses: [], user_goals: [],
  ride_days: [], job_posts: [], job_checks: [], job_saves: [], events: [], event_topics: [], event_rsvps: [], user_interests: [],
  connections: [], connection_requests: [], notifications: [], conversations: [], conversation_members: [], messages: [],
  weekly_emails: [], events_digests: [], practice_answers: [], me_roles: [],
};

// India week (Asia/Kolkata), as src/lib/ride/days.ts counts it: rows for earlier weeks only, so this week's crons send.
const indiaToday = new Date(now + 5.5 * HOUR);
const mondayIndia = new Date(Date.UTC(indiaToday.getUTCFullYear(), indiaToday.getUTCMonth(), indiaToday.getUTCDate()) - ((indiaToday.getUTCDay() + 6) % 7) * DAY);
const isoDay = (d) => d.toISOString().slice(0, 10);
const weeksBack = (k) => isoDay(new Date(mondayIndia.getTime() - k * 7 * DAY));
const indiaDayBack = (k) => isoDay(new Date(Date.UTC(indiaToday.getUTCFullYear(), indiaToday.getUTCMonth(), indiaToday.getUTCDate()) - k * DAY));

/** A long-tailed count: most members few, some many (mean about `mean`), at most `max`. */
const tail = (mean, max) => Math.min(max, Math.floor(-Math.log(1 - R.next()) * mean));

// ---- Shared rows: feed posts, the feed run, Timetable events ---------------------------------------------------------
const roleList = ROLE_WEIGHTS.map(([slug]) => roles.get(slug));
const openPostIds = [];
const closedPostIds = [];
for (let k = 0; k < OPEN_POSTS + CLOSED_POSTS; k++) {
  const open = k < OPEN_POSTS;
  const role = R.chance(0.85) ? pickRole() : R.pick(roleList);
  const req = required(role);
  const id = R.uuid();
  const firstSeen = open ? daysAgo(R.int(0, 45)) : daysAgo(R.int(30, 400));
  const closedAt = open ? null : new Date(Math.min(firstSeen.getTime() + R.int(5, 60) * DAY, now - DAY));
  (open ? openPostIds : closedPostIds).push(id);
  rows.job_posts.push({
    id,
    ats: R.pick(["greenhouse", "lever", "ashby", "smartrecruiters"]),
    board_token: `${BOARD_PREFIX}${k % 80}`,
    external_id: `scale-${k}`,
    url: `https://boards.example.com/scale/${k}`,
    title: R.chance(0.5) ? role.title : R.pick(role.typicalTitles ?? [role.title]),
    company: company(),
    city: R.chance(0.12) ? "Remote" : pickCity(),
    work_type: "full_time",
    experience_note: R.chance(0.6) ? `${R.int(0, 4)} to ${R.int(5, 9)} years` : null,
    role_slug: R.chance(0.9) ? role.slug : null,
    required_skill_ids: req.filter(() => R.chance(0.7)).map((s) => s.skillId),
    nice_skill_ids: nice(role).filter(() => R.chance(0.3)).map((s) => s.skillId),
    posted_at: R.chance(0.8) ? firstSeen : null,
    first_seen_at: firstSeen,
    last_seen_at: open ? at(R.int(1, 20) * HOUR) : closedAt,
    closed_at: closedAt,
  });
}
const feedRun = { id: FEED_RUN_ID, started_at: at(3 * HOUR), finished_at: at(3 * HOUR - 120_000), boards_ok: 80, boards_failed: 0, posts_open: OPEN_POSTS, posts_closed: 0 };

const popularSkills = [...new Set(roleList.flatMap((r) => required(r).map((s) => s.skillId)))];
const eventIds = { upcoming: [], past: [] };
for (let k = 0; k < EVENTS; k++) {
  // 75% ahead in the next 60 days, 15% ended in the last 90, 10% ended longer ago (the daily cleanup's to delete).
  const x = R.next();
  const startsAt = x < 0.75 ? at(-(R.int(2, 60 * 24) * HOUR)) : x < 0.9 ? daysAgo(R.int(1, 89)) : daysAgo(R.int(91, 200));
  const online = R.chance(0.3);
  const id = R.uuid();
  (x < 0.75 ? eventIds.upcoming : eventIds.past).push(id);
  rows.events.push({
    id,
    source: "feed",
    source_key: `${EVENT_PREFIX}${k}`,
    source_url: `https://events.example.com/scale/${k}`,
    title: `Synthetic ${R.pick(["meetup", "workshop", "study group", "conference"])} ${k}`,
    organiser: `${R.pick(CO_A)} Community`,
    kind: online ? "online" : R.pick(["meetup", "workshop", "conference"]),
    starts_at: startsAt,
    ends_at: new Date(startsAt.getTime() + R.int(1, 8) * HOUR),
    online,
    city: online ? null : pickCity(),
    venue: online ? null : "Example Hall",
    cost: R.chance(0.8) ? "Free" : "₹200",
    status: R.chance(0.95) ? "live" : "cancelled",
    checked_at: at(R.int(1, 30) * HOUR),
  });
  const topics = new Set();
  const n = R.int(1, 3);
  while (topics.size < n) topics.add(R.pick(popularSkills));
  for (const topic of topics) rows.event_topics.push({ event_id: id, kind: "skill", topic });
  if (R.chance(0.4)) rows.event_topics.push({ event_id: id, kind: "interest", topic: R.pick(interestTopics).key });
}

// ---- Members ------------------------------------------------------------------------------------------------------
const members = [];
const byRole = new Map();
for (let n = 1; n <= MEMBERS; n++) {
  const timed = TIMED_MEMBERS.includes(n);
  const id = R.uuid();
  const first = R.pick(FIRST);
  const last = R.pick(LAST);
  const email = memberEmail(n);
  const role = pickRole();
  const joined = R.int(1, 300);
  const createdAt = daysAgo(joined);
  // Activity: how often they come back. The timed members ride most days, like the people who open the app daily.
  const activity = timed ? 0.8 : R.pick([0, 0.05, 0.2, 0.2, 0.5, 0.8]);
  const member = { n, id, email, role, activity, timed, connections: new Set(), goals: [] };
  members.push(member);
  byRole.set(role.slug, [...(byRole.get(role.slug) ?? []), member]);
  rows.users.push({
    id,
    email,
    auth_subject: `test:${email}`,
    name: `${first} ${last}`,
    first_name: first,
    last_name: last,
    age_confirmed_at: createdAt,
    last_seen_at: daysAgo(activity > 0 ? R.int(0, Math.min(joined, 14)) : R.int(0, joined)),
    weekly_hours: R.pick([3, 5, 5, 8, 10, 15]),
    created_at: createdAt,
    username: R.chance(0.6) || timed ? `scale-${String(n).padStart(5, "0")}` : null,
    username_changed_at: null,
    headline: R.chance(0.5) ? `Working toward ${role.title}` : null,
    city: R.chance(0.85) || timed ? pickCity() : null,
  });
  rows.consents.push({ user_id: id, email, purpose: "account", policy_version: policyVersion, given_at: createdAt });

  // Settings: most members saved at least one choice. Visibility and the find-me switch as a cautious beta might set them.
  if (timed || R.chance(0.9)) {
    const vis = timed ? "signed_in" : R.pick(["signed_in", "signed_in", "signed_in", "signed_in", "connections", "connections", "connections", "line", "only_me", "only_me"]);
    member.findable = timed || R.chance(0.45);
    member.visibility = vis;
    member.gapsTo = timed ? "profile" : R.pick(["profile", "profile", "connections", "connections", "connections", "nobody"]);
    member.weekly = timed || R.chance(0.25);
    member.digest = timed || R.chance(0.2);
    rows.user_settings.push({
      user_id: id,
      profile_visibility: vis,
      show_target_role: R.chance(0.5),
      show_gaps: member.gapsTo !== "nobody",
      gaps_visible_to: member.gapsTo,
      people_can_find: member.findable,
      email_weekly_summary: member.weekly,
      events_digest: member.digest,
      events_radius_km: R.chance(0.7) ? 25 : 100,
      events_online: R.chance(0.8),
      job_search: R.chance(0.85) || timed,
      open_to_work_in: R.chance(0.5) ? [...new Set([R.chance(0.3) ? "Remote" : pickCity(), pickCity()])] : [],
      updated_at: daysAgo(R.int(0, joined)),
    });
  }
  if (R.chance(0.3)) rows.user_plans.push({ user_id: id, elite_since: daysAgo(R.int(0, joined)), badge_shown: R.chance(0.3) });

  // ---- Resume, profile and its gap analysis, built the way the matcher's result looks --------------------------------
  const resumeId = R.uuid();
  const profileId = R.uuid();
  member.resumeId = resumeId;
  rows.resumes.push({ id: resumeId, user_id: id, mime_type: "application/pdf", size_bytes: R.int(40_000, 400_000), status: "parsed", created_at: createdAt, source: "upload" });
  const req = required(role);
  const metShare = 0.25 + R.next() * 0.45;
  const met = req.filter(() => R.next() < metShare).map((s) => s.skillId);
  const gaps = req.filter((s) => !met.includes(s.skillId)).slice(0, 20);
  if (!gaps.length) gaps.push(req[req.length - 1]);
  const profile = {
    headline: role.title,
    totalYearsExperience: R.int(0, 9),
    roles: [
      {
        title: R.pick(role.typicalTitles ?? [role.title]),
        employer: company(),
        start: `${2026 - R.int(1, 6)}-0${R.int(1, 9)}`,
        end: null,
        highlights: ["Synthetic highlight about weekly reporting work", "Synthetic highlight about a team project"],
      },
    ],
    skills: met.map((skillId) => ({ name: skillName.get(skillId), lastUsed: null, evidence: [`Used ${skillName.get(skillId)} on synthetic project work`] })),
    education: [{ qualification: "B.Tech", institution: R.pick(INSTITUTES), year: String(2026 - R.int(1, 10)) }],
    certifications: [],
  };
  rows.profiles.push({ id: profileId, resume_id: resumeId, version: 1, data: profile, confirmed_by_user: true, created_at: createdAt });
  const analysisId = R.uuid();
  const analysis = (r, gs, ms) => ({
    roleSlug: r.slug,
    gaps: gs.map((s) => ({
      skillId: s.skillId,
      skillName: skillName.get(s.skillId),
      status: "missing",
      resumeQuote: null,
      requirement: s.expectation || `Use ${skillName.get(s.skillId)} at work`,
      explanation: `Nothing on the resume shows ${skillName.get(s.skillId)} yet.`,
    })),
    metSkillIds: ms,
    niceToHave: [],
    readiness: { headline: "Getting closer", explanation: "Synthetic readiness note for the scale check.", estimatedHours: gs.length * 12 },
  });
  // About 6% changed destination once: an earlier analysis for another role, with goals left on that line.
  let earlier = null;
  if (R.chance(0.06)) {
    const other = R.pick(roleList.filter((r) => r.slug !== role.slug));
    const otherGaps = required(other).filter((s) => !met.includes(s.skillId) && !gaps.some((g) => g.skillId === s.skillId)).slice(0, 6);
    if (otherGaps.length) {
      earlier = { id: R.uuid(), gaps: otherGaps };
      rows.gap_analyses.push({ id: earlier.id, profile_id: profileId, role_slug: other.slug, result: analysis(other, otherGaps, met), created_at: new Date(createdAt.getTime() + HOUR) });
    }
  }
  rows.gap_analyses.push({ id: analysisId, profile_id: profileId, role_slug: role.slug, result: analysis(role, gaps, met), created_at: new Date(createdAt.getTime() + 2 * HOUR) });
  member.gapSkills = gaps.map((g) => g.skillId);

  // ---- Goals: one per gap, the first few met for active members; a "Your choice" goal or two ----------------------
  let position = 0;
  const metCount = Math.floor(gaps.length * activity * 0.5);
  for (const g of gaps) {
    const goalId = R.uuid();
    const status = position < metCount ? "met" : "active";
    rows.user_goals.push({
      id: goalId,
      user_id: id,
      skill_id: g.skillId,
      source: "gap",
      status,
      position: position++,
      gap_analysis_id: analysisId,
      met_at: status === "met" ? daysAgo(R.int(0, joined)) : null,
      created_at: new Date(createdAt.getTime() + 2 * HOUR),
    });
    member.goals.push({ id: goalId, skillId: g.skillId, status });
  }
  if (earlier) {
    for (const g of earlier.gaps.slice(0, 2)) {
      rows.user_goals.push({ id: R.uuid(), user_id: id, skill_id: g.skillId, source: "gap", status: "active", position: position++, gap_analysis_id: earlier.id, met_at: null, created_at: new Date(createdAt.getTime() + HOUR) });
    }
  }
  const taken = new Set(rows.user_goals.slice(-position).map((g) => g.skill_id));
  for (let c = R.chance(0.3) ? R.int(1, 2) : 0; c > 0; c--) {
    const skillId = R.pick(popularSkills);
    if (taken.has(skillId)) continue;
    taken.add(skillId);
    rows.user_goals.push({ id: R.uuid(), user_id: id, skill_id: skillId, source: "user", status: "active", position: position++, gap_analysis_id: null, met_at: null, created_at: daysAgo(R.int(0, joined)) });
  }

  // ---- Ride days over the last 90 days -----------------------------------------------------------------------------
  const rideGoal = member.goals.find((g) => g.status === "active") ?? member.goals[0];
  if (activity > 0 && rideGoal) {
    for (let k = 0; k < Math.min(90, joined); k++) {
      if (!R.chance(activity)) continue;
      const tasks = [`${rideGoal.id}:self-study`];
      if (R.chance(0.4)) tasks.push(`${rideGoal.id}:practice`);
      rows.ride_days.push({ user_id: id, day: indiaDayBack(k), task_ids: tasks, updated_at: daysAgo(k) });
    }
  }

  // ---- My jobs: jobs added from other sites (job checks) and feed posts, with stages and notes ------------------
  // Gaps-page checks keep no text and are never saved; a few "Add a job you found" checks were never saved either.
  for (let c = R.int(0, 3); c > 0; c--) {
    rows.job_checks.push({ id: R.uuid(), resume_id: resumeId, role_slug: role.slug, company: company(), title: role.title, required_skill_ids: req.slice(0, 5).map((s) => s.skillId), text_hash: `scale-${n}-g${c}`, url: null, source: "pasted", city: null, description: null, created_at: daysAgo(R.int(0, joined)) });
  }
  if (R.chance(0.05)) {
    rows.job_checks.push({ id: R.uuid(), resume_id: resumeId, role_slug: role.slug, company: company(), title: role.title, required_skill_ids: [], text_hash: `scale-${n}-u`, url: `https://jobs.example.com/scale/${n}/unsaved`, source: "pasted", city: pickCity(), description: "Synthetic job description, never saved.", created_at: daysAgo(R.int(2, 20)) });
  }
  const added = timed ? 25 : tail(4, 120);
  const saved = timed ? 30 : tail(6, 150);
  const stageOf = () => {
    const x = R.next();
    return x < 0.45 ? null : x < 0.7 ? 1 : x < 0.8 ? 2 : x < 0.86 ? 3 : x < 0.88 ? 4 : x < 0.97 ? 5 : 6;
  };
  const saveRow = (ref, i) => {
    const stage = stageOf();
    const when = daysAgo(R.int(0, Math.min(joined, 120)));
    rows.job_saves.push({
      id: R.uuid(),
      user_id: id,
      job_post_id: ref.post ?? null,
      job_check_id: ref.check ?? null,
      saved_at: stage === null || R.chance(0.6) ? when : null,
      stage,
      applied_at: stage ? when : null,
      interview_at: stage === 3 ? at(-R.int(-3, 14) * DAY - R.int(1, 10) * HOUR) : null,
      closed_at: stage === 5 || stage === 6 ? when : null,
      note: R.chance(0.3) ? `Synthetic note ${i}` : null,
      status_at: when,
      updated_at: when,
    });
  };
  for (let i = 0; i < added; i++) {
    const checkId = R.uuid();
    rows.job_checks.push({
      id: checkId,
      resume_id: resumeId,
      role_slug: role.slug,
      company: company(),
      title: R.pick(role.typicalTitles ?? [role.title]),
      required_skill_ids: req.filter(() => R.chance(0.7)).map((s) => s.skillId),
      text_hash: `scale-${n}-${i}`,
      url: `https://jobs.example.com/scale/${n}/${i}`,
      source: "pasted",
      city: pickCity(),
      description: R.chance(0.3) ? `Synthetic job description ${i} for the scale check. `.repeat(R.int(5, 40)) : null,
      created_at: daysAgo(R.int(0, Math.min(joined, 120))),
    });
    saveRow({ check: checkId }, i);
  }
  const posts = new Set();
  for (let i = 0; i < Math.min(saved, 300 - added); i++) {
    const post = R.chance(0.8) ? R.pick(openPostIds) : R.pick(closedPostIds);
    if (posts.has(post)) continue;
    posts.add(post);
    saveRow({ post }, added + i);
  }

  // ---- Timetable: interests and marks ------------------------------------------------------------------------------
  if (timed || R.chance(0.6)) {
    const picked = new Set();
    for (let c = R.int(1, 4); c > 0; c--) picked.add(R.pick(interestTopics).label.slice(0, 40));
    for (const name of picked) rows.user_interests.push({ user_id: id, name, name_key: name.trim().replace(/\s+/g, " ").toLowerCase(), created_at: daysAgo(R.int(0, joined)) });
  }
  if (timed || R.chance(0.25)) {
    const marked = new Set();
    for (let c = R.int(1, 6); c > 0; c--) {
      const eventId = R.chance(0.8) ? R.pick(eventIds.upcoming) : R.pick(eventIds.past);
      if (marked.has(eventId)) continue;
      marked.add(eventId);
      const going = R.chance(0.4);
      rows.event_rsvps.push({ user_id: id, event_id: eventId, state: going ? "going" : "saved", goal_skill_id: going && R.chance(0.5) && rideGoal ? rideGoal.skillId : null, created_at: daysAgo(R.int(0, 30)) });
    }
  }

  // ---- Past weekly emails and digests (some over 90 days old, the cleanup's to delete) -----------------------------
  if (member.weekly && R.chance(0.6)) {
    const weeks = R.int(1, 16);
    for (let k = 1; k <= weeks; k++) rows.weekly_emails.push({ user_id: id, week: weeksBack(k), sent_at: new Date(Date.parse(weeksBack(k)) + 3 * HOUR) });
  }
  if (member.digest && R.chance(0.5)) {
    const weeks = R.int(1, 16);
    for (let k = 1; k <= weeks; k++) rows.events_digests.push({ user_id: id, week: weeksBack(k), sent_at: new Date(Date.parse(weeksBack(k)) + 2 * HOUR) });
  }

  // ---- Practice answers (some past the 30 days they are kept) and a role added on Me -----------------------------
  const practiceSkill = member.goals.map((g) => g.skillId).find((s) => practiceQuestions.some((q) => q.skillId === s));
  if (practiceSkill && R.chance(0.15)) {
    const qs = practiceQuestions.filter((q) => q.skillId === practiceSkill);
    for (let c = R.int(1, 10); c > 0; c--) rows.practice_answers.push({ id: R.uuid(), user_id: id, skill_id: practiceSkill, question_id: R.pick(qs).id, answer: "Synthetic practice answer.", confidence: R.int(1, 4), created_at: daysAgo(R.int(0, 45)) });
  }
  if (R.chance(0.2)) {
    const start = `${2026 - R.int(3, 8)}-0${R.int(1, 9)}`;
    rows.me_roles.push({ id: R.uuid(), user_id: id, title: R.pick(role.typicalTitles ?? [role.title]), employer: company(), start_month: start, end_month: `${Number(start.slice(0, 4)) + 1}-12`, is_current: false });
  }
}

// ---- Network: connections (mostly people on the same line), open and old requests, notifications, a few chats ------
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairs = new Set();
const connect = (a, b, how, when) => {
  if (a.id === b.id) return false;
  const key = pairKey(a.id, b.id);
  if (pairs.has(key)) return false;
  pairs.add(key);
  a.connections.add(b);
  b.connections.add(a);
  const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  rows.connections.push({ user_low: low, user_high: high, how, created_at: when });
  return true;
};
for (const m of members) {
  const want = m.timed ? 40 : tail(4, 300);
  for (let c = 0; c < want; c++) {
    const same = R.chance(0.6) ? byRole.get(m.role.slug) : members;
    connect(m, R.pick(same), R.pick(["same_line", "same_line", "worked_together", "studied_together", "event", "other"]), daysAgo(R.int(0, 200)));
  }
}
const asked = new Set();
for (const m of members) {
  const want = m.timed ? 6 : R.chance(0.35) ? R.int(1, 4) : 0;
  for (let c = 0; c < want; c++) {
    const to = R.pick(R.chance(0.6) ? byRole.get(m.role.slug) : members);
    const key = pairKey(m.id, to.id);
    if (to.id === m.id || pairs.has(key) || asked.has(key)) continue;
    asked.add(key);
    // Open requests within CONNECTION_REQUEST_DAYS; older ones were ignored or withdrawn.
    const status = R.chance(0.7) ? "pending" : R.pick(["ignored", "withdrawn", "expired"]);
    const requestId = R.uuid();
    const createdAt = status === "pending" ? daysAgo(R.int(0, 28)) : daysAgo(R.int(31, 120));
    rows.connection_requests.push({ id: requestId, from_user: m.id, to_user: to.id, how: R.pick(["same_line", "worked_together", "studied_together", "event", "other"]), status, created_at: createdAt, decided_at: status === "pending" ? null : new Date(createdAt.getTime() + DAY) });
    if (status === "pending") rows.notifications.push({ id: R.uuid(), user_id: to.id, kind: "connection_request", actor_id: m.id, connection_request_id: requestId, created_at: createdAt, read_at: R.chance(0.5) ? new Date(createdAt.getTime() + HOUR) : null });
  }
}
for (const m of members) {
  if (!(m.timed || R.chance(0.15)) || !m.connections.size) continue;
  const peers = [...m.connections];
  const chats = new Set();
  for (let c = R.int(1, 3); c > 0; c--) chats.add(R.pick(peers));
  for (const peer of chats) {
    const conversationId = R.uuid();
    const count = R.int(2, 12);
    const last = at(R.int(1, 60 * 24) * 60_000 * 30);
    rows.conversations.push({ id: conversationId, kind: "direct", status: "open", started_by: m.id, created_at: new Date(last.getTime() - count * HOUR), last_message_at: last });
    rows.conversation_members.push({ conversation_id: conversationId, user_id: m.id, last_read_at: R.chance(0.5) ? last : null });
    rows.conversation_members.push({ conversation_id: conversationId, user_id: peer.id, last_read_at: R.chance(0.5) ? last : null });
    for (let k = 0; k < count; k++) {
      rows.messages.push({ id: R.uuid(), conversation_id: conversationId, sender_id: k % 2 ? peer.id : m.id, body: `Synthetic message ${k + 1}.`, created_at: new Date(last.getTime() - (count - 1 - k) * HOUR) });
    }
  }
}

/* Writing --------------------------------------------------------------------------------------------------------- */

/** Postgres takes at most 65,535 parameters a statement; each slice stays well under. */
async function insertAll(sql, table, list, json = []) {
  if (!list.length) return 0;
  const columns = Object.keys(list[0]);
  const per = Math.max(1, Math.floor(30_000 / columns.length));
  for (let i = 0; i < list.length; i += per) {
    // jsonb columns as JSON parameters (the root client's helper; a parameter belongs to no connection).
    const slice = list.slice(i, i + per).map((r) => (json.length ? { ...r, ...Object.fromEntries(json.map((c) => [c, db.json(r[c])])) } : r));
    await sql`insert into ${sql(table)} ${sql(slice, ...columns)}`;
  }
  return list.length;
}

const url = process.env.DATABASE_URL;
assertLocalDatabase(url);
const db = postgres(url, { max: 1, onnotice: () => {} });
const sql = db;
try {
  const started = Date.now();
  const removed = await cleanScale(sql);
  if (removed.members) console.log(`scale seed: removed an earlier copy (${removed.members} members)`);
  const known = new Set((await sql`select id from skills`).map((r) => r.id));
  const missing = popularSkills.filter((s) => !known.has(s));
  if (missing.length) throw new Error(`run npm run db:seed first: ${missing.length} skills are missing`);
  const roleIds = new Map((await sql`select distinct on (slug) slug, id from role_profiles order by slug, version desc`).map((r) => [r.slug, r.id]));
  const analyses = rows.gap_analyses.map(({ role_slug, ...r }) => ({ ...r, role_profile_id: roleIds.get(role_slug) ?? null, matcher_version: "scale-seed" }));

  const counts = {};
  await sql.begin(async (tx) => {
    counts.jobPosts = await insertAll(tx, "job_posts", rows.job_posts);
    await insertAll(tx, "job_feed_runs", [feedRun]);
    counts.events = await insertAll(tx, "events", rows.events);
    counts.eventTopics = await insertAll(tx, "event_topics", rows.event_topics);
    counts.members = await insertAll(tx, "users", rows.users);
    await insertAll(tx, "consents", rows.consents);
    counts.settings = await insertAll(tx, "user_settings", rows.user_settings);
    counts.elite = await insertAll(tx, "user_plans", rows.user_plans);
    await insertAll(tx, "resumes", rows.resumes);
    await insertAll(tx, "profiles", rows.profiles, ["data"]);
    counts.analyses = await insertAll(tx, "gap_analyses", analyses, ["result"]);
    counts.goals = await insertAll(tx, "user_goals", rows.user_goals);
    counts.rideDays = await insertAll(tx, "ride_days", rows.ride_days);
    counts.jobChecks = await insertAll(tx, "job_checks", rows.job_checks);
    counts.myJobs = await insertAll(tx, "job_saves", rows.job_saves);
    counts.interests = await insertAll(tx, "user_interests", rows.user_interests);
    counts.eventMarks = await insertAll(tx, "event_rsvps", rows.event_rsvps);
    counts.connections = await insertAll(tx, "connections", rows.connections);
    counts.requests = await insertAll(tx, "connection_requests", rows.connection_requests);
    counts.notifications = await insertAll(tx, "notifications", rows.notifications);
    counts.chats = await insertAll(tx, "conversations", rows.conversations);
    await insertAll(tx, "conversation_members", rows.conversation_members);
    counts.messages = await insertAll(tx, "messages", rows.messages);
    counts.weeklyEmails = await insertAll(tx, "weekly_emails", rows.weekly_emails);
    counts.digests = await insertAll(tx, "events_digests", rows.events_digests);
    counts.practiceAnswers = await insertAll(tx, "practice_answers", rows.practice_answers);
    counts.meRoles = await insertAll(tx, "me_roles", rows.me_roles);
  });
  // Fresh statistics, as autovacuum would have them on a database that grew to this size over months.
  await sql`analyze`;
  // Counts only: no text the seed wrote.
  console.log(`scale seed: ${JSON.stringify(counts)} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} finally {
  await sql.end();
}
