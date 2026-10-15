import { decimalYear, readYearMonth } from "@/lib/map/life-layout";
import { worked } from "@/lib/me/build";
import type { FindBand, Profile } from "@/lib/schemas";
import type { JobMatchView, OrgReviewStatus, OrgRole } from "./types";

/*
 * The rules of "Let companies find me" (pending item 19, dev/companies-find-me-plan.md) as plain functions, so they are
 * tested without a database: who may search, the filters, who is listed and in which order. No model and no
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
 * Whether a person passes the experience filter: any band when none is chosen, else one of the chosen bands. With a
 * band chosen, only people whose experience shows on their profile can match, so a part they hid is never searchable.
 */
export function inBands(bands: readonly FindBand[], years: number, experienceShown: boolean): boolean {
  if (!bands.length) return true;
  return experienceShown && bands.includes(bandOf(years));
}

/**
 * Whether a person passes the other filters (T44): one of the chosen target roles, when any is chosen (companies see the
 * target role of everyone who lets them find them); one of the chosen cities, when any is chosen (people who gave no
 * city never match one); and a verified profile, when asked: at least one skill proved by CareerMetro proof (an exam, a
 * verified certificate or corroborated work), never a resume line alone.
 */
export function passesFilters(
  f: { roles: readonly string[]; cities: readonly string[]; verified: boolean },
  p: { roleSlug: string; city: string | null; provedSkills: number },
): boolean {
  if (f.roles.length && !f.roles.includes(p.roleSlug)) return false;
  if (f.cities.length && !(p.city && f.cities.includes(p.city))) return false;
  return !f.verified || p.provedSkills > 0;
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

/* Typed search: name, role and current company (Milin 2026-10-15) ---------------------------------------------------- */

/** Lowercase letters and digits only, single-spaced: "Priya  N." and "priya n" read the same. */
export function searchKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Words that say what kind of company it is, not which one, so "Example Labs Pvt. Ltd." is "Example Labs". */
const COMPANY_SUFFIXES = new Set(["pvt", "private", "ltd", "limited", "llp", "inc", "corp", "corporation", "co", "company", "plc", "llc", "gmbh"]);

/** A company name to compare by: its search key without the legal-form words. */
export function companyKey(name: string): string {
  return searchKey(name)
    .split(" ")
    .filter((w) => w && !COMPANY_SUFFIXES.has(w))
    .join(" ");
}

/**
 * The person's current jobs on the confirmed profile: the ones with no end date; with none open, the latest one
 * (Project manager, 2026-10-15: the latest job stands in for the current employer, which isn't stored separately).
 */
export function currentJobs(profile: Profile): Profile["roles"] {
  const open = profile.roles.filter((r) => !r.end);
  if (open.length) return open;
  const latest = [...profile.roles].sort((a, b) => (readYearMonth(b.end)?.t ?? 0) - (readYearMonth(a.end)?.t ?? 0))[0];
  return latest ? [latest] : [];
}

/**
 * Whether the person works at the searching company now, by their current employer on the profile matching the
 * company's name or legal name. A company never sees them (Project manager under Milin's delegation, 2026-10-15,
 * keeping his 2026-10-09 rule that an employee's job search stays hidden from their employer).
 */
export function worksAt(profile: Profile, companyNames: readonly (string | null)[]): boolean {
  const keys = new Set(companyNames.map((n) => (n ? companyKey(n) : "")).filter(Boolean));
  return currentJobs(profile).some((r) => keys.has(companyKey(r.employer)));
}

/** Every word typed is the start of a word in the name: "pri nai" finds Priya Nair. */
export function nameMatches(query: string, name: string | null): boolean {
  const words = searchKey(name ?? "").split(" ");
  const asked = searchKey(query).split(" ").filter(Boolean);
  return asked.length > 0 && asked.every((q) => words.some((w) => w.startsWith(q)));
}

/** The typed words appear together in one of these texts. */
const appearsIn = (query: string, texts: (string | null | undefined)[]) => {
  const q = searchKey(query);
  return texts.some((t) => !!t && ` ${searchKey(t)} `.includes(` ${q}`));
};

/**
 * Whether a person passes the typed search. Name: every word starts a word of their name. Role: their target role
 * (companies always see it) or a current job title. Company: a current employer. Job titles and employers count only
 * when experience shows on their profile, so a part they hid is never searchable.
 */
export function passesText(
  q: { name: string; title: string; company: string },
  p: { name: string | null; aim: string | null; profile: Profile; experienceShown: boolean },
): boolean {
  if (q.name && !nameMatches(q.name, p.name)) return false;
  const jobs = p.experienceShown ? currentJobs(p.profile) : [];
  if (q.title && !appearsIn(q.title, [p.aim, ...jobs.map((r) => r.title)])) return false;
  if (q.company && !jobs.some((r) => companyKey(r.employer).includes(companyKey(q.company)) && companyKey(q.company) !== "")) return false;
  return true;
}
