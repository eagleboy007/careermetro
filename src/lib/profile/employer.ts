import { readYearMonth } from "@/lib/map/life-layout";
import type { Profile } from "@/lib/schemas";

/*
 * Employers on a profile, compared as plain text: Find people (dev/companies-find-me-plan.md) and the work-email check
 * of the current job (FR-47, dev/current-job-check-plan.md) both use these.
 */

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
