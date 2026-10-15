import { describe, expect, it } from "vitest";
import { certifications } from "@/content";
import { meCertification } from "@/lib/schemas";
import { profileCertifications, type ProofCertRow } from "./certs";
import { publicCertifications } from "./public";

const TODAY = "2026-10-13";
let n = 0;
const proof = (over: Partial<ProofCertRow> = {}): ProofCertRow => ({
  proofId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  certId: "aws-cloud-practitioner",
  credentialKey: `key-${n}`,
  issuedOn: "2025-03-01",
  expiresOn: "2028-03-01",
  verifier: null,
  url: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000001",
  badgeId: "c4ed1100-0000-4000-8000-000000000001",
  checkNote: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
});

describe("profileCertifications", () => {
  it("shows the name, issuer, month issued and status of an accepted certificate", () => {
    const [c] = profileCertifications({ proofs: [proof({ verifier: "credly" })], resume: [], today: TODAY });
    expect(c).toMatchObject({
      name: "AWS Certified Cloud Practitioner",
      issuer: "Amazon Web Services",
      date: "Mar 2025",
      status: "verified",
      fromResume: false,
      expired: null,
      badgeUrl: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000001",
      note: null,
      canCheck: true,
    });
    expect(meCertification.safeParse(c).success).toBe(true);
  });

  it("labels an unchecked or mismatched one Added by you, with the reason for the owner and no link", () => {
    const [plain, mismatch] = profileCertifications({
      proofs: [proof({ issuedOn: "2025-05-01" }), proof({ certId: "comptia-security-plus", issuedOn: "2024-01-01", checkNote: "earner_name" })],
      resume: [],
      today: TODAY,
    });
    expect(plain).toMatchObject({ status: "added", badgeUrl: null, note: null });
    expect(mismatch).toMatchObject({ name: "CompTIA Security+", status: "added", badgeUrl: null, note: "The name on the Credly badge doesn't match your account." });
  });

  it("only offers a Credly check for a Credly badge link", () => {
    const [c] = profileCertifications({ proofs: [proof({ url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/ABC", badgeId: null })], resume: [], today: TODAY });
    expect(c).toMatchObject({ canCheck: false, badgeUrl: null });
  });

  it("shows one entry per credential, whatever number of skills it proves, verified if any row is", () => {
    const rows = [proof({ credentialKey: "same" }), proof({ credentialKey: "same", verifier: "credly" })];
    const out = profileCertifications({ proofs: rows, resume: [], today: TODAY });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("verified");
    expect(rows.map((r) => r.proofId)).toContain(out[0].proofId);
  });

  it("shows a certificate once, even with two credentials (a renewal with a new id): the verified or current one", () => {
    const out = profileCertifications({
      proofs: [proof({ issuedOn: "2022-01-01", expiresOn: "2025-01-01" }), proof({ issuedOn: "2025-02-01", expiresOn: "2028-02-01" })],
      resume: [],
      today: TODAY,
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: "Feb 2025", expired: null });
  });

  it("puts verified first, then the most recently issued, then the resume's, and expired ones last, marked", () => {
    const out = profileCertifications({
      proofs: [
        proof({ certId: "comptia-security-plus", issuedOn: "2026-01-01" }),
        proof({ certId: "aws-cloud-practitioner", issuedOn: "2024-02-01", verifier: "credly" }),
        proof({ certId: "ccna", issuedOn: "2025-06-01" }),
        proof({ certId: "cka", issuedOn: "2023-01-01", expiresOn: "2026-10-12" }),
      ],
      resume: [
        { name: "Google Data Analytics Certificate", earned: "2024-05", expires: null },
        { name: "Old cert", earned: "2019", expires: "2021" },
      ],
      today: TODAY,
    });
    expect(out.map((c) => c.name)).toEqual([
      "AWS Certified Cloud Practitioner",
      "CompTIA Security+",
      "Cisco Certified Network Associate (CCNA)",
      "Google Data Analytics Certificate",
      "Certified Kubernetes Administrator (CKA)",
      "Old cert",
    ]);
    expect(out[4]).toMatchObject({ expired: "Oct 2026" });
    expect(out[5]).toMatchObject({ expired: "2021", fromResume: true });
    // Expiring today is still current (India date).
    expect(profileCertifications({ proofs: [proof({ expiresOn: TODAY })], resume: [], today: TODAY })[0].expired).toBeNull();
  });

  it("lists the resume's certificates as added by the person, placing the issuer when the name is on our list, without repeating a proof", () => {
    const out = profileCertifications({
      proofs: [proof()],
      resume: [
        { name: "aws cloud practitioner", earned: null, expires: null },
        { name: "Tableau Desktop Specialist", earned: "2024", expires: "none" },
        { name: "My college hackathon", earned: null, expires: null },
        { name: " ", earned: null, expires: null },
        { name: "tableau desktop specialist", earned: null, expires: null },
      ],
      today: TODAY,
    });
    expect(out.map((c) => [c.name, c.issuer, c.date, c.status, c.fromResume, c.canCheck, c.proofId])).toEqual([
      ["AWS Certified Cloud Practitioner", "Amazon Web Services", "Mar 2025", "added", false, true, out[0].proofId],
      ["Tableau Desktop Specialist", "Tableau (Salesforce)", "2024", "added", true, false, null],
      ["My college hackathon", null, null, "added", true, false, null],
    ]);
  });

  it("shows a Credly badge waiting for its check as pending, below an accepted proof of the same certificate, and never publicly", () => {
    const [waiting] = profileCertifications({ proofs: [proof({ pending: true, checkNote: "unreachable" })], resume: [], today: TODAY });
    expect(waiting).toMatchObject({ status: "pending", note: expect.stringMatching(/Credly didn't answer/), canCheck: true });
    const both = profileCertifications({ proofs: [proof({ pending: true }), proof({ credentialKey: "other" })], resume: [], today: TODAY });
    expect(both).toHaveLength(1);
    expect(both[0].status).toBe("added");
    expect(publicCertifications([waiting])).toEqual([]);
  });

  it("keeps inside the schema for long names and many certificates", () => {
    const long = "x".repeat(500);
    const out = profileCertifications({
      proofs: certifications.slice(0, 40).map((c) => proof({ certId: c.id })),
      resume: Array.from({ length: 40 }, (_, i) => ({ name: `${long}${i}`, earned: null, expires: null })),
      today: TODAY,
    });
    expect(out).toHaveLength(30);
    for (const c of out) expect(meCertification.safeParse(c).success).toBe(true);
  });
});
