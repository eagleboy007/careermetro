import { skillGroupMembers } from "@/content";
import { profileMatcher, type MatchResult } from "@/lib/gaps/match";
import { postingRole } from "@/lib/jobs/groups";
import { jobPost, type JobPost, type Profile, type RoleProfile } from "@/lib/schemas";
import { JOB_WORK_TYPE_LABELS } from "@/lib/schemas/constants";

/*
 * Fit on live Departures (docs/plans/departures-live-plan.md): a feed post's skills, found by code, run through the same
 * plain-code matcher as the pasted-job check (postingRole), against the person's latest confirmed profile, their goals
 * and their proof. Nothing about the person leaves the server and no model is called. Pure, so tests and /design can
 * use it.
 */

/** One open or saved post as the store reads it. */
export type StoredPost = {
  id: string;
  title: string;
  company: string;
  city: string;
  workType: keyof typeof JOB_WORK_TYPE_LABELS;
  experienceNote: string | null;
  roleSlug: string | null;
  requiredSkillIds: string[];
  niceSkillIds: string[];
  url: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  closedAt: Date | null;
};

/** What fit is read against. Null for someone with no confirmed resume: rows then show without fit. */
export type FitContext = {
  profile: Profile;
  /** The role the person's line is built for. */
  targetSlug: string | null;
  /** Skills of the person's open goals (active or renew), with the skill each was swapped to. */
  goalSkillIds: ReadonlySet<string>;
  /** Skills with current accepted proof. */
  proved: ReadonlySet<string>;
};

/** Below this many required skills found, a post shows no fit. */
export const MIN_FIT_SKILLS = 2;
export const TOO_FEW_SKILLS = "Fit not shown: the post names too few skills we know.";

const DAY = 24 * 60 * 60 * 1000;
/** India's calendar day of a moment, as a day number, so "today" and "2 days ago" turn at midnight in India. */
const indiaDayNumber = (d: Date) => Math.floor((d.getTime() + 5.5 * 60 * 60 * 1000) / DAY);

/** "today", "yesterday" or "3 days ago", by India's calendar. */
export function postedWords(postedAt: Date, now = new Date()): string {
  const days = Math.max(0, indiaDayNumber(now) - indiaDayNumber(postedAt));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Whether a goal on the person's line closes this gap: the goal's own skill, or its "one of these" group. */
function onLine(skillId: string, goals: ReadonlySet<string>): boolean {
  if (goals.has(skillId)) return true;
  for (const members of skillGroupMembers.values()) if (members.includes(skillId) && members.some((m) => goals.has(m))) return true;
  return false;
}

function why(gaps: number, onYourLine: number, destination: boolean): string {
  if (gaps === 0) return "Every required skill in the post is on your resume or proved.";
  const line = onYourLine === gaps ? (gaps === 1 ? "It is a goal on your line." : "Each is a goal on your line.") : onYourLine === 0 ? "None is a goal on your line yet." : onYourLine === 1 ? "One of them is a goal on your line." : `${onYourLine} of them are goals on your line.`;
  return destination ? `The role your line is built for. ${line}` : `${line} You can still apply now.`;
}

/**
 * One post as a Departures row. With a context, its required skills are matched: "You have" lists what the resume
 * shows or proof covers, the gaps name each skill whose goal closes it, and readiness counts them. A post with fewer
 * than two required skills found shows no fit, and says why. `matchRole` is `profileMatcher(ctx.profile, now)` when
 * many posts are read against the same context.
 */
export function postView(post: StoredPost, ctx: FitContext | null, now = new Date(), matchRole?: (role: RoleProfile) => MatchResult): JobPost {
  const base = {
    id: post.id,
    role: post.title,
    company: post.company,
    city: post.city,
    workType: JOB_WORK_TYPE_LABELS[post.workType],
    experience: post.experienceNote ?? "",
    posted: postedWords(post.postedAt ?? post.firstSeenAt, now),
    roleSlug: post.roleSlug,
    applyUrl: post.url,
    closed: post.closedAt !== null,
  };
  if (!ctx) return jobPost.parse({ ...base, gaps: [], have: [], goalsBefore: 0, why: "" });
  if (new Set(post.requiredSkillIds).size < MIN_FIT_SKILLS) return jobPost.parse({ ...base, gaps: [], have: [], goalsBefore: 0, why: "", fitNote: TOO_FEW_SKILLS });

  const match = (matchRole ?? profileMatcher(ctx.profile, now))(postingRole(post, now));
  const have = match.met.map((m) => m.skillName);
  const gaps: JobPost["gaps"] = [];
  let onYourLine = 0;
  for (const g of match.gaps) {
    if (ctx.proved.has(g.skillId)) {
      have.push(g.skillName);
      continue;
    }
    gaps.push({ status: g.status === "missing" ? "missing" : "weak", name: g.skillName });
    if (onLine(g.skillId, ctx.goalSkillIds)) onYourLine++;
  }
  const destination = post.roleSlug !== null && post.roleSlug === ctx.targetSlug;
  return jobPost.parse({
    ...base,
    gaps: gaps.slice(0, 12),
    have: have.slice(0, 20),
    goalsBefore: gaps.length,
    destination,
    why: why(gaps.length, onYourLine, destination),
  });
}

/**
 * Every post that makes a valid row, in order. One the row schema refuses is left out and its id returned in `skipped`
 * for the caller to log, so one odd post never takes Departures or Today's board down.
 */
export function postViews(posts: readonly StoredPost[], ctx: FitContext | null, now = new Date()): { jobs: JobPost[]; skipped: string[] } {
  const jobs: JobPost[] = [];
  const skipped: string[] = [];
  // The resume is read once for every post (T161).
  const matchRole = ctx ? profileMatcher(ctx.profile, now) : undefined;
  for (const p of posts) {
    try {
      jobs.push(postView(p, ctx, now, matchRole));
    } catch {
      skipped.push(p.id);
    }
  }
  return { jobs, skipped };
}

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" });
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * The header's freshness: "Updated 19:42" (India time) from the last good feed run, or "Updated 18 Oct" once no run has
 * finished in 36 hours. Null before the first run.
 */
export function updatedWords(finishedAt: Date | null, now = new Date()): string | null {
  if (!finishedAt) return null;
  return now.getTime() - finishedAt.getTime() <= 36 * 60 * 60 * 1000 ? `Updated ${TIME.format(finishedAt)}` : `Updated ${DATE.format(finishedAt)}`;
}
