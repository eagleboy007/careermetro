import { monthLabel } from "@/lib/map/life-layout";
import { companyKey, currentJobs } from "@/lib/profile/employer";
import type { Profile } from "@/lib/schemas";
import type { JobEmailCheckStatus } from "@/lib/schemas/constants";

/*
 * The rules of the work-email check of the current job (FR-47, handoff 12d, dev/current-job-check-plan.md) as plain
 * functions, tested without a database: which job is checked, which jobs are self-declared, when an email's domain
 * plainly belongs to the company, and the label each job shows.
 */

type Role = Profile["roles"][number];

/** A job as the check knows it: the employer as written, its comparison key, and the start month ("" without one). */
export type JobKey = { employer: string; employerKey: string; startMonth: string };

/** A saved check, as read for a profile. */
export type JobCheckRow = { employerKey: string; startMonth: string; status: JobEmailCheckStatus; checkedAt: Date };

/** What a job on the profile says about its check. Older jobs say nothing (null). */
export type ExperienceCheck = {
  state: "verified" | "verified_while_there" | "review" | "self_declared" | "not_verified";
  /** "Oct 2026": when the check passed. Only for verified states. */
  month: string | null;
};

/** Freelance and self-employed work has no company mailbox to check (12d): it shows "Self-declared". */
const SELF_DECLARED = /\b(free[- ]?lanc\w*|self[- ]?employed|independent( consultant| contractor)?|own (business|practice)|sole proprietor\w*)\b/i;

export const isSelfDeclared = (employer: string): boolean => SELF_DECLARED.test(employer);

/** "2024-06" and "2024" as written on the profile; "" for anything else, which is no start date. */
export const startMonthOf = (start: string | null | undefined): string => {
  const s = start?.trim() ?? "";
  return /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(s) ? s : "";
};

export const jobKeyOf = (role: Pick<Role, "employer" | "start">): JobKey => ({
  employer: role.employer.trim().slice(0, 120),
  employerKey: companyKey(role.employer).slice(0, 120),
  startMonth: startMonthOf(role.start),
});

/**
 * The job a work email checks: the current job on the confirmed profile (the open one that started last, else the
 * latest), unless it is self-declared or has no company name to compare. Older jobs are never checked.
 */
export function jobToCheck(profile: Profile | null): JobKey | null {
  if (!profile) return null;
  const [job] = [...currentJobs(profile)].sort((a, b) => startMonthOf(b.start).localeCompare(startMonthOf(a.start)));
  if (!job || isSelfDeclared(job.employer)) return null;
  const key = jobKeyOf(job);
  return key.employerKey ? key : null;
}

/** Second-level labels under a country code: "example.co.in" is example's, not "co"'s. */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "ac", "edu", "gov", "gen", "firm", "ind", "res", "ltd", "plc"]);

/** The name part of a domain: "mail.garudasec.co.in" is "garudasec". */
export function domainName(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  let end = labels.length - 1;
  if (end >= 2 && SECOND_LEVEL.has(labels[end - 1]!)) end -= 1;
  return labels[end - 1]!.replace(/[^a-z0-9]/g, "");
}

/**
 * Whether an email domain plainly belongs to the employer: its name is the company's words run together
 * ("garudasec.com" for "Garuda Sec Pvt Ltd"), their first word ("infosys.com" for "Infosys BPM"), or their initials
 * ("tcs.com" for "Tata Consultancy Services"). Anything else is still accepted, but an admin looks before the badge shows.
 */
export function domainMatchesEmployer(domain: string, employerKey: string): boolean {
  const name = domainName(domain);
  const words = employerKey.split(" ").filter(Boolean);
  if (name.length < 2 || words.length === 0) return false;
  const joined = words.join("");
  const initials = words.length >= 2 ? words.map((w) => w[0]).join("") : "";
  return name === joined || (words[0]!.length >= 3 && name === words[0]) || (initials.length >= 2 && name === initials);
}

/**
 * The label for one job on the profile. Only the job a work email checks gets one, plus any job whose own check
 * passed (it keeps "Verified while there" once it has an end date). Self-declared current work says so.
 */
export function experienceCheck(role: Pick<Role, "employer" | "start" | "end">, check: JobKey | null, rows: readonly JobCheckRow[]): ExperienceCheck | null {
  const key = jobKeyOf(role);
  const row = rows.find((r) => r.employerKey === key.employerKey && r.startMonth === key.startMonth);
  if (row?.status === "verified") return { state: role.end ? "verified_while_there" : "verified", month: monthLabel(row.checkedAt) };
  const isChecked = !!check && check.employerKey === key.employerKey && check.startMonth === key.startMonth;
  if (!isChecked) return !role.end && isSelfDeclared(role.employer) ? { state: "self_declared", month: null } : null;
  return { state: row?.status === "review" ? "review" : "not_verified", month: null };
}

/** The words for each label. "review" reads as not verified to anyone but the person. */
export function experienceCheckText(c: ExperienceCheck, own: boolean): string {
  switch (c.state) {
    case "verified":
      return `Verified with work email · ${c.month}`;
    case "verified_while_there":
      return `Verified while there · ${c.month}`;
    case "self_declared":
      return "Self-declared";
    case "review":
      return own ? "Work email received · we're checking the domain" : "Not verified";
    case "not_verified":
      return "Not verified";
  }
}
