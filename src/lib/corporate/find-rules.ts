import { decimalYear, readYearMonth } from "@/lib/map/life-layout";
import { worked } from "@/lib/me/build";
import type { FindBand, Profile } from "@/lib/schemas";
import type { JobMatchView, OrgReviewStatus, OrgRole } from "./types";

/*
 * The rules of "Let companies find me" (pending item 19, dev/companies-find-me-plan.md) as plain functions, so they are
 * tested without a database: who may search, the experience band, who is listed and in which order. No model and no
 * score: the order comes from Match to this job in words, the same for everyone.
 */

export type FindRefusal = "interviewer" | "not_verified" | "not_on_job" | "job_not_open";

/**
 * Whether this person may search from (and open people for, and write to people found from) this job: a Recruiter
 * admin for any open job of a verified company, Hiring HR only for open jobs they are on, an Interviewer never.
 */
export function findRefusal(x: { role: OrgRole; onJobTeam: boolean; orgStatus: OrgReviewStatus; jobStatus: string }): FindRefusal | null {
  if (x.role === "interviewer") return "interviewer";
  if (x.orgStatus !== "verified") return "not_verified";
  if (x.role === "hiring" && !x.onJobTeam) return "not_on_job";
  if (x.jobStatus !== "open") return "job_not_open";
  return null;
}

/**
 * Years worked from the confirmed profile, counted the way the profile's experience total is (overlapping roles once);
 * the resume's own total when no role has dates.
 */
export function yearsWorked(profile: Profile, now: Date): number {
  const nowT = decimalYear(now);
  const spans: [number, number][] = [];
  for (const r of profile.roles) {
    const start = readYearMonth(r.start);
    const until = readYearMonth(r.end)?.t ?? (start ? nowT : null);
    if (start && until !== null && until > start.t) spans.push([start.t, until]);
  }
  const total = worked(spans);
  return total > 0 ? total : (profile.totalYearsExperience ?? 0);
}

/** The band a number of years falls in: under 2, 2 to under 5, 5 to under 10, 10 or more. */
export function bandOf(years: number): FindBand {
  if (years < 2) return "0-2";
  if (years < 5) return "2-5";
  if (years < 10) return "5-10";
  return "10+";
}

/**
 * Whether a person passes the band filter. With a band, only people whose experience shows on their profile can match,
 * so a part they hid is never searchable.
 */
export function inBand(band: FindBand | null, years: number, experienceShown: boolean): boolean {
  if (!band) return true;
  return experienceShown && bandOf(years) === band;
}

/** Listed only when at least one required skill (or "one of these" group) is proved or on the resume. */
export const matchesJob = (m: JobMatchView): boolean => m.lines.some((l) => l.group !== "nice" && l.state !== "not_on_resume");

const niceCount = (m: JobMatchView, state: "proved" | "on_resume") => m.lines.filter((l) => l.group === "nice" && l.state === state).length;

/**
 * The order of results: required proved first, then required on the resume, then nice to have proved, then on the
 * resume, then the per-company ref (stable, and says nothing about the person).
 */
export function compareFound(a: { match: JobMatchView; ref: string }, b: { match: JobMatchView; ref: string }): number {
  return (
    b.match.requiredProved - a.match.requiredProved ||
    b.match.requiredOnResume - a.match.requiredOnResume ||
    niceCount(b.match, "proved") - niceCount(a.match, "proved") ||
    niceCount(b.match, "on_resume") - niceCount(a.match, "on_resume") ||
    (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)
  );
}
