import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { baseDomain, domainAndParents, experienceCheck, experienceCheckText, isSelfDeclared, jobKeyOf, jobToCheck, onVerifiedCompanyDomain, startMonthOf } from "./job-check-rules";

const role = (employer: string, start: string | null, end: string | null = null) => ({ title: "Analyst", employer, start, end, highlights: [] });
const profile = (roles: ReturnType<typeof role>[]): Profile => ({ headline: null, totalYearsExperience: 3, roles, skills: [], education: [], certifications: [] });
const OCT = new Date("2026-10-16T10:00:00Z");

describe("the work-email check of the current job (FR-47)", () => {
  it("checks the current job only: the open one that started last, else the latest", () => {
    expect(jobToCheck(profile([role("Garuda Sec Pvt Ltd", "2024-06"), role("Konkan Bank", "2021-01", "2024-05")]))).toEqual({
      employer: "Garuda Sec Pvt Ltd",
      employerKey: "garuda sec",
      startMonth: "2024-06",
    });
    expect(jobToCheck(profile([role("Konkan Bank", "2021-01", "2024-05"), role("Garuda Sec", "2019-01", "2020-12")]))?.employer).toBe("Konkan Bank");
    expect(jobToCheck(profile([role("Old Co", "2020", null), role("New Co", "2024-02", null)]))?.employer).toBe("New Co");
    expect(jobToCheck(profile([]))).toBeNull();
    expect(jobToCheck(null)).toBeNull();
  });

  it("never checks freelance or self-employed work, which is self-declared", () => {
    for (const e of ["Freelance", "Freelancer (design)", "Self-employed", "Self employed", "Independent consultant", "Own business"]) expect(isSelfDeclared(e)).toBe(true);
    expect(isSelfDeclared("Garuda Sec")).toBe(false);
    expect(jobToCheck(profile([role("Freelance", "2024-06")]))).toBeNull();
    expect(experienceCheck(role("Freelance", "2024-06"), null, [])).toEqual({ state: "self_declared", month: null });
    expect(experienceCheck(role("Freelance", "2020-01", "2021-01"), null, [])).toBeNull();
  });

  it("keys a job by its company and start month, so a new company or start date is a new job", () => {
    expect(startMonthOf("2024-06")).toBe("2024-06");
    expect(startMonthOf("2024")).toBe("2024");
    expect(startMonthOf("June 2024")).toBe("");
    expect(startMonthOf(null)).toBe("");
    expect(jobKeyOf(role("Example Labs Private Limited", "2024-06")).employerKey).toBe("example labs");
  });

  it("passes a check without an admin only on the domain of a verified company under the employer's name (T53)", () => {
    const garuda = [{ emailDomain: "garudasec.co.in", names: ["Garuda Sec", "Garuda Sec Private Limited"] }];
    expect(onVerifiedCompanyDomain("garudasec.co.in", "Garuda Sec Pvt Ltd", garuda)).toBe(true);
    expect(onVerifiedCompanyDomain("mail.garudasec.co.in", "Garuda Sec India", garuda)).toBe(true);
    // A look-alike domain, a free-mail domain and the right domain under another employer all go to an admin.
    expect(onVerifiedCompanyDomain("garudasec.xyz", "Garuda Sec", garuda)).toBe(false);
    expect(onVerifiedCompanyDomain("garudasec.firm.in", "Garuda Sec", garuda)).toBe(false);
    expect(onVerifiedCompanyDomain("yahoo.co.uk", "Yahoo", garuda)).toBe(false);
    expect(onVerifiedCompanyDomain("notgarudasec.co.in", "Garuda Sec", garuda)).toBe(false);
    expect(onVerifiedCompanyDomain("garudasec.co.in", "Konkan Bank", garuda)).toBe(false);
    expect(onVerifiedCompanyDomain("garudasec.co.in", "Garuda Sec", [])).toBe(false);
    // Initials or a first word alone never pass: bp.com isn't Bharat Petroleum's unless that company verified it.
    expect(onVerifiedCompanyDomain("bp.com", "Bharat Petroleum", garuda)).toBe(false);
  });

  it("finds the registered domain and its parents, so subdomains share one daily code limit (T66)", () => {
    expect(baseDomain("mail.garudasec.co.in")).toBe("garudasec.co.in");
    expect(baseDomain("soc.in.infosys.com")).toBe("infosys.com");
    expect(baseDomain("example.com")).toBe("example.com");
    expect(domainAndParents("mail.garudasec.co.in")).toEqual(["mail.garudasec.co.in", "garudasec.co.in", "co.in"]);
    expect(domainAndParents("example.com")).toEqual(["example.com"]);
  });

  it("labels the checked job, keeps a passed check after an end date, and says nothing about older jobs", () => {
    const now = role("Garuda Sec", "2024-06");
    const key = jobKeyOf(now);
    const verified = [{ employerKey: "garuda sec", startMonth: "2024-06", status: "verified" as const, checkedAt: OCT }];
    expect(experienceCheck(now, key, [])).toEqual({ state: "not_verified", month: null });
    expect(experienceCheck(now, key, verified)).toEqual({ state: "verified", month: "Oct 2026" });
    expect(experienceCheck(role("Garuda Sec", "2024-06", "2026-09"), null, verified)).toEqual({ state: "verified_while_there", month: "Oct 2026" });
    expect(experienceCheck(now, key, [{ ...verified[0], status: "review" }])).toEqual({ state: "review", month: null });
    expect(experienceCheck(now, key, [{ ...verified[0], status: "refused" }])).toEqual({ state: "not_verified", month: null });
    // A new start date on the profile is a new job: the old check doesn't carry over.
    const moved = role("Garuda Sec", "2025-01");
    expect(experienceCheck(moved, jobKeyOf(moved), verified)).toEqual({ state: "not_verified", month: null });
    expect(experienceCheck(role("Konkan Bank", "2021-01", "2024-05"), key, [])).toBeNull();
  });

  it("gives nothing for a check saved on the other side of the profile, and keeps the key-only rule for older rows (T100)", () => {
    const now = role("Garuda Sec", "2024-06");
    const key = jobKeyOf(now);
    const verified = { employerKey: "garuda sec", startMonth: "2024-06", status: "verified" as const, checkedAt: OCT };
    expect(experienceCheck(now, key, [{ ...verified, source: "added" }], "resume")).toBeNull();
    expect(experienceCheck(now, key, [{ ...verified, source: "added" }], "added")).toEqual({ state: "verified", month: "Oct 2026" });
    expect(experienceCheck(now, key, [verified], "resume")).toEqual({ state: "verified", month: "Oct 2026" });
    expect(experienceCheck(role("Freelance", "2024-06"), null, [{ ...verified, employerKey: "freelance", source: "added" }], "resume")).toEqual({ state: "self_declared", month: null });
  });

  it("says each label in words, and a domain under review reads as not verified to others", () => {
    expect(experienceCheckText({ state: "verified", month: "Oct 2026" }, false)).toBe("Verified with work email · Oct 2026");
    expect(experienceCheckText({ state: "verified_while_there", month: "Oct 2026" }, false)).toBe("Verified while there · Oct 2026");
    expect(experienceCheckText({ state: "self_declared", month: null }, false)).toBe("Self-declared");
    expect(experienceCheckText({ state: "review", month: null }, false)).toBe("Not verified");
    expect(experienceCheckText({ state: "review", month: null }, true)).toContain("checking");
  });
});
