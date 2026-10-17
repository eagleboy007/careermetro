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

/** Words that many company names share, left out when deciding whether two names are one company. */
const SHARED_WORDS = new Set(["india", "technologies", "technology", "solutions", "services", "software", "systems", "global", "group", "the", "and"]);

/**
 * Whether two company names plainly name the same company, leaning towards yes: one name's words appear together in
 * the other ("Infosys" and "Infosys BPM", "Example Labs" and "Example Labs India"), even run together ("HCLTech" and
 * "HCL Technologies"), or one is the other's initials
 * ("TCS" and "Tata Consultancy Services"). Used to keep people out of their own employer's search, where a wrong yes
 * only hides someone and a wrong no shows them to their employer.
 */
export function sameCompany(a: string, b: string): boolean {
  const wordsA = companyKey(a).split(" ").filter(Boolean);
  const wordsB = companyKey(b).split(" ").filter(Boolean);
  const coreA = wordsA.filter((w) => !SHARED_WORDS.has(w)).join(" ");
  const coreB = wordsB.filter((w) => !SHARED_WORDS.has(w)).join(" ");
  if (coreA && coreB && (` ${coreA} `.includes(` ${coreB} `) || ` ${coreB} `.includes(` ${coreA} `))) return true;
  // A brand run together ("HCLTech", "InfosysBPM"): the company search finds it by a plain part of the name, so the
  // same part hides it (T71). Three letters or more, so "a" or "it" never hides anyone.
  const runA = coreA.replace(/ /g, "");
  const runB = coreB.replace(/ /g, "");
  if ((runB.length >= 3 && runA.includes(runB)) || (runA.length >= 3 && runB.includes(runA))) return true;
  const initials = (words: string[]) => (words.length >= 2 ? words.map((w) => w[0]).join("") : "");
  const single = (words: string[]) => (words.length === 1 && words[0]!.length >= 2 ? words[0]! : "");
  return (!!single(wordsA) && single(wordsA) === initials(wordsB)) || (!!single(wordsB) && single(wordsB) === initials(wordsA));
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
