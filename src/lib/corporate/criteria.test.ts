import { describe, expect, it } from "vitest";
import { certificateName, certificateOptions, criteriaNames, criteriaStatus, unknownCertificates } from "./criteria";
import { criteriaSummary } from "./match-words";

/* Express apply criteria (pending item 16): met only by current accepted proof, never by the resume alone. */

const criteria = { verifiedSkills: ["siem", "linux"], certificates: ["comptia-security-plus", "sc-200"] };

describe("Express apply criteria", () => {
  it("read each criterion as met or not yet from the person's accepted proofs", () => {
    const c = criteriaStatus(criteria, new Set(["siem"]), new Set(["sc-200"]));
    expect(c.lines).toEqual([
      { kind: "skill", label: "SIEM and log analysis", met: true },
      { kind: "skill", label: "Linux command line", met: false },
      { kind: "certificate", label: "CompTIA Security+", met: false },
      { kind: "certificate", label: expect.stringMatching(/SC-200/), met: true },
    ]);
    expect(c).toMatchObject({ met: 2, total: 4 });
    expect(criteriaSummary(c)).toBe("2 of 4 criteria met");
  });

  it("are empty, and say so, when the job asks for none", () => {
    const c = criteriaStatus({ verifiedSkills: [], certificates: [] }, new Set(["siem"]), new Set());
    expect(c).toEqual({ lines: [], met: 0, total: 0 });
    expect(criteriaSummary(c)).toBe("No Express apply criteria");
  });

  it("say when all are met, in words", () => {
    expect(criteriaSummary({ met: 1, total: 1 })).toBe("Criterion met");
    expect(criteriaSummary({ met: 0, total: 1 })).toBe("0 of 1 criterion met");
    expect(criteriaSummary({ met: 3, total: 3 })).toBe("All 3 criteria met");
  });

  it("name skills and certificates from our lists, and find ids that aren't on them", () => {
    expect(criteriaNames(criteria)).toEqual({ verifiedSkills: ["SIEM and log analysis", "Linux command line"], certificates: ["CompTIA Security+", expect.stringMatching(/SC-200/)] });
    expect(unknownCertificates({ verifiedSkills: [], certificates: ["comptia-security-plus", "made-up-cert"] })).toEqual(["made-up-cert"]);
    expect(certificateName("gone-cert")).toBe("gone-cert");
    const options = certificateOptions();
    expect(options.length).toBeGreaterThan(20);
    expect(options[0]).toEqual({ id: expect.any(String), name: expect.any(String), issuer: expect.any(String) });
  });
});
