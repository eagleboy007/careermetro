import { describe, expect, it } from "vitest";
import { COMPANY_AUDIT_ACTIONS, COMPANY_AUDIT_LABELS, companyAuditLine } from "./corporate";
import { findOpenInput, findRef, findRequestInput, findSearchFromParams, findSearchInput, foundMessageInput } from "./find-people";

const JOB = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";
const ORG = "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";
const REF = "A".repeat(20) + "b-_".repeat(13);

describe("find people schemas (pending item 19)", () => {
  it("search by a job and a page, with any of experience bands, target roles and verified profiles (T44)", () => {
    expect(findSearchInput.parse({ jobId: JOB })).toEqual({ jobId: JOB, bands: [], roles: [], cities: [], verified: false, page: 1 });
    expect(findSearchInput.parse({ jobId: JOB, bands: ["2-5", "10+", "2-5"], roles: ["data-analyst", "soc-analyst-l1"], cities: ["Pune", "Kochi", "Pune"], verified: true, page: 3 })).toEqual({
      jobId: JOB,
      bands: ["2-5", "10+"],
      roles: ["data-analyst", "soc-analyst-l1"],
      cities: ["Pune", "Kochi"],
      verified: true,
      page: 3,
    });
    const tooManyRoles = Array.from({ length: 11 }, (_, i) => `role-${i}`);
    for (const bad of [
      { jobId: "SOC analyst" },
      { jobId: JOB, bands: ["3-4"] },
      { jobId: JOB, bands: "2-5" },
      { jobId: JOB, roles: ["Data Analyst"] },
      { jobId: JOB, roles: ["../x"] },
      { jobId: JOB, roles: tooManyRoles },
      { jobId: JOB, cities: ["pune"] },
      { jobId: JOB, cities: ["Flat 4, MG Road, Pune"] },
      { jobId: JOB, verified: "yes" },
      { jobId: JOB, page: 0 },
      { jobId: JOB, page: 51 },
      { jobId: JOB, page: 1.5 },
    ]) {
      expect(findSearchInput.safeParse(bad).success).toBe(false);
    }
  });

  it("take no free text a company could put a name or a phone in", () => {
    const r = findSearchInput.safeParse({ jobId: JOB, query: "Priya Sharma +91 98765 43210" });
    // Unknown keys are dropped, never searched.
    expect(r.success).toBe(true);
    expect(r.success && "query" in r.data).toBe(false);
  });

  it("read an address leniently, dropping what isn't one of the choices", () => {
    const empty = { bands: [], roles: [], cities: [], verified: false };
    expect(findSearchFromParams({ job: JOB, band: "5-10", page: "2" })).toEqual({ jobId: JOB, ...empty, bands: ["5-10"], page: 2 });
    expect(findSearchFromParams({ job: JOB, band: ["0-2", "any", "10+"], role: ["data-analyst", "Data Analyst"], city: ["Kochi", "Atlantis"], verified: "1" })).toEqual({
      jobId: JOB,
      bands: ["0-2", "10+"],
      roles: ["data-analyst"],
      cities: ["Kochi"],
      verified: true,
      page: 1,
    });
    expect(findSearchFromParams({ job: "x", band: "any", verified: "yes", page: "-3" })).toEqual({ jobId: null, ...empty, page: 1 });
    expect(findSearchFromParams({ job: [JOB, JOB], page: "999" })).toEqual({ jobId: null, ...empty, page: 1 });
  });

  it("name people only by an opaque ref of the right shape", () => {
    expect(REF).toHaveLength(59);
    expect(findRef.safeParse(REF).success).toBe(true);
    for (const bad of [JOB, REF.slice(1), `${REF}=`, REF.replace("A", "+"), "priya@example.com"]) expect(findRef.safeParse(bad).success).toBe(false);
    expect(findOpenInput.safeParse({ jobId: JOB, ref: REF }).success).toBe(true);
    expect(findOpenInput.safeParse({ jobId: JOB, ref: JOB }).success).toBe(false);
  });

  it("send one message of up to 2,000 characters", () => {
    expect(findRequestInput.parse({ jobId: JOB, ref: REF, body: "  Hello, would you like to talk about our SOC role?  " }).body).toBe("Hello, would you like to talk about our SOC role?");
    expect(findRequestInput.safeParse({ jobId: JOB, ref: REF, body: "   " }).success).toBe(false);
    expect(findRequestInput.safeParse({ jobId: JOB, ref: REF, body: "x".repeat(2001) }).success).toBe(false);
    expect(foundMessageInput.safeParse({ conversationId: JOB, body: "Thanks" }).success).toBe(true);
  });

  it("audit searches, views and requests by job only", () => {
    for (const action of ["people_searched", "found_profile_viewed", "found_request_sent"] as const) {
      expect(COMPANY_AUDIT_ACTIONS).toContain(action);
      expect(COMPANY_AUDIT_LABELS[action]).toMatch(/^[A-Z]/);
      expect(companyAuditLine.safeParse({ orgId: ORG, actor: `member:${JOB}`, action, target: `job:${JOB}` }).success).toBe(true);
    }
    // A band, a name or a ref is never a target.
    for (const target of ["band:2-5", `person:${REF}`, "Priya Sharma"]) {
      expect(companyAuditLine.safeParse({ orgId: ORG, actor: `member:${JOB}`, action: "people_searched", target }).success).toBe(false);
    }
  });
});
