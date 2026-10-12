import { describe, expect, it } from "vitest";
import { certifications } from "@/content";
import { allowedVerifyLink, checkCertificate } from "./rules";

const env = { NAME_HASH_KEY: "test-key" };
const aws = certifications.find((c) => c.id === "aws-cloud-practitioner")!;
const base = {
  submission: { issuedOn: "2025-03-01", expiresOn: "2028-03-01", nameOnCertificate: "Priya Sharma", url: "https://www.credly.com/badges/abc" },
  cert: aws,
  fillingSkills: ["aws"],
  accountName: "Priya Sharma",
  today: "2026-10-12",
  env,
};

describe("checkCertificate", () => {
  it("accepts a current certificate in the person's name that proves the goal's skill", () => {
    expect(checkCertificate(base)).toEqual({ ok: true, skillId: "aws" });
  });

  it("fills a 'one of these' goal through any skill of its group", () => {
    expect(checkCertificate({ ...base, fillingSkills: ["azure", "aws", "gcp"] })).toEqual({ ok: true, skillId: "aws" });
  });

  it("refuses a certificate not on our list, or one that doesn't fully cover the skill", () => {
    expect(checkCertificate({ ...base, cert: undefined })).toEqual({ ok: false, reason: "unknown_cert" });
    expect(checkCertificate({ ...base, fillingSkills: ["sql"] })).toEqual({ ok: false, reason: "not_covered" });
    // Partial skills are only touched, never shown.
    expect(aws.partial.length).toBeGreaterThan(0);
    expect(checkCertificate({ ...base, fillingSkills: aws.partial })).toEqual({ ok: false, reason: "not_covered" });
  });

  it("refuses an expired certificate, and one issued in the future", () => {
    expect(checkCertificate({ ...base, submission: { ...base.submission, expiresOn: "2026-10-11" } })).toEqual({ ok: false, reason: "expired" });
    expect(checkCertificate({ ...base, submission: { ...base.submission, expiresOn: "2026-10-12" } }).ok).toBe(true);
    expect(checkCertificate({ ...base, submission: { ...base.submission, expiresOn: null } }).ok).toBe(true);
    expect(checkCertificate({ ...base, submission: { ...base.submission, issuedOn: "2026-10-13" } })).toEqual({ ok: false, reason: "issued_in_future" });
  });

  it("matches names ignoring case, dots, spacing and order, and blocks other names", () => {
    for (const n of ["PRIYA SHARMA", "Sharma, Priya", "Priya  K. Sharma"]) {
      expect(checkCertificate({ ...base, submission: { ...base.submission, nameOnCertificate: n } }).ok).toBe(true);
    }
    expect(checkCertificate({ ...base, submission: { ...base.submission, nameOnCertificate: "Amit Sharma" } })).toEqual({ ok: false, reason: "name" });
    expect(checkCertificate({ ...base, accountName: null })).toEqual({ ok: false, reason: "no_name" });
  });

  it("refuses links that aren't a badge platform or an issuer's verify page", () => {
    expect(checkCertificate({ ...base, submission: { ...base.submission, url: "https://my-certs.example.com/aws" } })).toEqual({ ok: false, reason: "link" });
  });
});

describe("allowedVerifyLink", () => {
  it.each([
    ["https://www.credly.com/badges/1", true],
    ["https://credly.com/badges/1", true],
    ["https://learn.microsoft.com/api/credentials/share/en-us/x", true],
    ["https://cp.certmetrics.com/amazon/en/public/verify/credential/x", true],
    ["http://www.credly.com/badges/1", false],
    ["https://credly.com.evil.example/badges/1", false],
    ["https://evilcredly.com/badges/1", false],
    ["https://user:pass@www.credly.com/badges/1", false],
    ["https://www.credly.com:8443/badges/1", false],
    ["https://github.com/someone/fake-cert", false],
    // Places on issuer sites where anyone can publish.
    ["https://apex.oracle.com/pls/apex/r/me/fake-cert", false],
    ["https://discuss.hashicorp.com/t/my-certificate/1", false],
    ["https://learn.microsoft.com/answers/questions/1/fake", false],
    ["https://community.splunk.com/t5/fake", false],
    ["https://wiki.linuxfoundation.org/fake", false],
    ["https://anyone.accredible.com/abc", false],
    ["https://www.credential.net/abc", false],
    ["https://www.credly.com/users/someone", false],
    ["https://learn.microsoft.com/en-us/users/priya-1/credentials/abc123", true],
    ["https://www.coursera.org/verify/ABC123", true],
    ["not a url", false],
  ])("%s → %s", (url, ok) => {
    expect(allowedVerifyLink(url)).toBe(ok);
  });
});
