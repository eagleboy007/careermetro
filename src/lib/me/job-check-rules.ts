import { monthLabel } from "@/lib/map/life-layout";
import { baseDomain, isOnDomain } from "@/lib/corporate/domains";
import { companyKey, currentJobs, sameCompany } from "@/lib/profile/employer";
import type { Profile } from "@/lib/schemas";
import type { JOB_CHECK_SOURCES, JobEmailCheckStatus } from "@/lib/schemas/constants";

/*
 * The rules of the work-email check of the current job (FR-47, handoff 12d, dev/current-job-check-plan.md) as plain
 * functions, tested without a database: which job is checked, which jobs are self-declared, when an email's domain
 * plainly belongs to the company, and the label each job shows.
 */

type Role = Profile["roles"][number];

/** A job as the check knows it: the employer as written, its comparison key, and the start month ("" without one). */
export type JobKey = { employer: string; employerKey: string; startMonth: string };

/** The side of the profile a check was made on: a resume role or a role added on Me (T95). */
export type JobCheckSource = (typeof JOB_CHECK_SOURCES)[number];

/**
 * A saved check, as read for a profile. `employer` is the company as written on the job the check was made on, and
 * `source` the side that job was on (null on checks saved before it was kept); both tell a resume role and an added
 * role with the same badge key apart (T95). Never shown.
 */
export type JobCheckRow = { employerKey: string; startMonth: string; status: JobEmailCheckStatus; checkedAt: Date; employer?: string; source?: JobCheckSource | null };

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
 * The job a work email checks: the current job on the confirmed profile and the roles added on Me (the open one that
 * started last, else the latest), unless it is self-declared or has no company name to compare. Older jobs are never
 * checked.
 */
export function jobToCheck(profile: Pick<Profile, "roles"> | null): JobKey | null {
  if (!profile) return null;
  const [job] = [...currentJobs(profile)].sort((a, b) => startMonthOf(b.start).localeCompare(startMonthOf(a.start)));
  if (!job || isSelfDeclared(job.employer)) return null;
  const key = jobKeyOf(job);
  return key.employerKey ? key : null;
}

export { baseDomain };

/** The domain and every parent of it with two labels or more: "mail.example.co.in", "example.co.in", "co.in". */
export function domainAndParents(domain: string): string[] {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
}

/** A company on CareerMetro whose email domain was proved by its admin's code and checked by hand. */
export type VerifiedCompany = { emailDomain: string; names: readonly (string | null)[] };

/**
 * Whether a work email plainly belongs to the employer (T53): its domain is, or is under, the email domain of a company
 * CareerMetro has verified, and that company's name or legal name names the employer. A look-alike domain
 * (accenture.xyz), a free-mail domain and a name that only shares initials or a first word go to an admin instead.
 */
export function onVerifiedCompanyDomain(domain: string, employer: string, companies: readonly VerifiedCompany[]): boolean {
  return companies.some((c) => isOnDomain(domain, c.emailDomain) && c.names.some((n) => !!n && sameCompany(employer, n)));
}

/**
 * The label for one job on the profile. Only the job a work email checks gets one, plus any job whose own check
 * passed (it keeps "Verified while there" once it has an end date). Self-declared current work says so. With `side`,
 * a check saved on the other side of the profile gives this row nothing.
 */
export function experienceCheck(
  role: Pick<Role, "employer" | "start" | "end">,
  check: JobKey | null,
  rows: readonly JobCheckRow[],
  side?: JobCheckSource,
): ExperienceCheck | null {
  const key = jobKeyOf(role);
  const row = rows.find((r) => r.employerKey === key.employerKey && r.startMonth === key.startMonth);
  // T100: a check saved on the other side of the profile (a hand-added row, say) is that row's, even where only this
  // row is shown, as in every company view. Older rows with no side keep the key-only rule.
  if (side && row?.source && row.source !== side) return experienceCheck(role, null, []);
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
