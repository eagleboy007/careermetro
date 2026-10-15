import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/schemas";
import { exampleMe } from "./fixtures";
import { meCertification, type MeCertification, type MeProfile } from "@/lib/schemas";
import { PUBLIC_CERTIFICATIONS, PUBLIC_KEYS, publicProfile } from "./public";

const me = { ...exampleMe, headline: "IT support moving into security operations" };
const all = { showTargetRole: true, showExperience: true, showEducation: true, showSkills: true, showGaps: true, showCertifications: true };
const none = { showTargetRole: false, showExperience: false, showEducation: false, showSkills: false, showGaps: false, showCertifications: false };

describe("the public profile", () => {
  it("never carries resume lines, the journey, private stats or the resume, whatever the switches say", () => {
    const out = publicProfile(me, all);
    expect(me.experience.some((e) => e.highlights.length)).toBe(true);
    expect(out.experience.every((e) => e.highlights.length === 0)).toBe(true);
    expect(out.journey).toEqual([]);
    expect(out.stats.every((s) => !s.private)).toBe(true);
    expect(out.resumeReadOn).toBeNull();
    // Nothing in it reads like resume text: no highlight survives anywhere in the object.
    const text = JSON.stringify(out);
    for (const h of me.experience.flatMap((e) => e.highlights)) expect(text).not.toContain(h);
  });

  it("keeps name and headline and follows the defaults: target role and gaps off", () => {
    const out = publicProfile(me, DEFAULT_SETTINGS);
    expect(out.name).toBe(me.name);
    expect(out.headline).toBe(me.headline);
    expect(out.aim).toBeNull();
    expect(out.skills.weak).toEqual([]);
    expect(out.skills.missing).toEqual([]);
    expect(out.skills.have).toEqual(me.skills.have);
    expect(out.experience.map((e) => e.title)).toEqual(me.experience.map((e) => e.title));
    expect(out.education).toEqual(me.education);
    expect(out.certifications.map((c) => c.name)).toEqual(me.certifications.filter((c) => !c.expired && c.status !== "pending").map((c) => c.name).slice(0, 5));
  });

  it("shows the target role and gaps only when turned on", () => {
    const out = publicProfile(me, { ...DEFAULT_SETTINGS, showTargetRole: true, showGaps: true });
    expect(out.aim).toBe(me.aim);
    expect(out.skills.missing).toEqual(me.skills.missing);
    expect(out.skills.weak).toEqual(me.skills.weak);
  });

  it("is built from the allowed keys only, so a field added to the person's own profile never rides along", () => {
    const allowed = [...PUBLIC_KEYS].sort();
    expect(Object.keys(publicProfile(me, all)).sort()).toEqual(allowed);
    expect(Object.keys(publicProfile(me, none)).sort()).toEqual(allowed);
    // Fields other work adds to MeProfile (Nearby lines adds `nearby` and `changeRoleHref`) stay off /u.
    const withMore = { ...me, nearby: me.nearby ?? [{ title: "BI Analyst" }], changeRoleHref: "/resume/x/role", future: "x" } as unknown as MeProfile;
    expect(withMore.nearby).not.toBeNull();
    const out = publicProfile(withMore, all);
    expect(Object.keys(out).sort()).toEqual(allowed);
    expect(out.nearby).toBeNull();
    expect(out.changeRoleHref).toBeNull();
    expect("future" in out).toBe(false);
    // Nested parts are copied field by field too.
    const extraRole = { ...me, experience: me.experience.map((e) => ({ ...e, salary: "x" })) } as MeProfile;
    expect(JSON.stringify(publicProfile(extraRole, all))).not.toContain("salary");
  });

  it("hides each part that is turned off", () => {
    const out = publicProfile(me, none);
    expect(out.experience).toEqual([]);
    expect(out.experienceTotal).toBeNull();
    expect(out.education).toEqual([]);
    expect(out.skills).toEqual({ have: [], weak: [], missing: [] });
    expect(out.certifications).toEqual([]);
    expect(out.stats.find((s) => s.label === "skills found")).toBeUndefined();
  });
});

describe("certifications on the public profile (pending item 13)", () => {
  const cert = (over: Partial<MeCertification>): MeCertification => ({
    proofId: "00000000-0000-4000-8000-0000000c00aa",
    name: "AWS Certified Cloud Practitioner",
    issuer: "Amazon Web Services",
    date: "Mar 2025",
    status: "added",
    fromResume: false,
    expired: null,
    badgeUrl: null,
    note: null,
    canCheck: true,
    ...over,
  });

  it("shows at most 5, current ones only, in the profile's order: verified first", () => {
    const out = publicProfile(me, all).certifications;
    expect(PUBLIC_CERTIFICATIONS).toBe(5);
    expect(me.certifications.length).toBeGreaterThan(5);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ status: "verified", badgeUrl: expect.stringMatching(/^https:\/\/www\.credly\.com\/badges\//) });
    expect(out.every((c) => c.expired === null)).toBe(true);
    expect(me.certifications.some((c) => c.expired)).toBe(true);
    for (const c of out) expect(meCertification.safeParse(c).success).toBe(true);
  });

  it("carries the issuer, name, date and status, and nothing for the owner only", () => {
    const owner = [
      cert({ status: "verified", badgeUrl: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000001" }),
      cert({ name: "CompTIA Security+", note: "The name on the Credly badge doesn't match your account." }),
    ];
    const out = publicProfile({ ...me, certifications: owner }, all).certifications;
    expect(out).toEqual([
      {
        proofId: null,
        name: "AWS Certified Cloud Practitioner",
        issuer: "Amazon Web Services",
        date: "Mar 2025",
        status: "verified",
        fromResume: false,
        expired: null,
        badgeUrl: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000001",
        note: null,
        canCheck: false,
      },
      { proofId: null, name: "CompTIA Security+", issuer: "Amazon Web Services", date: "Mar 2025", status: "added", fromResume: false, expired: null, badgeUrl: null, note: null, canCheck: false },
    ]);
    const text = JSON.stringify(out);
    expect(text).not.toContain("0000000c00aa");
    expect(text).not.toContain("doesn't match");
  });

  it("never shows a link that isn't a verified badge's public Credly page, nor anything a certificate entry picked up", () => {
    const sneaky = [
      cert({ status: "added", badgeUrl: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000001" }),
      cert({ status: "verified", badgeUrl: "https://learn.microsoft.com/en-us/users/priyasharma/credentials/abc" }),
      { ...cert({}), credentialId: "SECRET-CRED", filePath: "proofs/u1/cert.pdf", nameOnCertificate: "Priya Sharma" } as MeCertification,
    ];
    const out = publicProfile({ ...me, certifications: sneaky }, all).certifications;
    expect(out.map((c) => c.badgeUrl)).toEqual([null, null, null]);
    const text = JSON.stringify(out);
    for (const bad of ["learn.microsoft.com", "SECRET-CRED", "cert.pdf", "nameOnCertificate", "Priya"]) expect(text).not.toContain(bad);
  });

  it("hides expired ones, and all of them with the Certifications switch off", () => {
    const out = publicProfile({ ...me, certifications: [cert({ expired: "Sep 2026" }), cert({ name: "Current" })] }, all).certifications;
    expect(out.map((c) => c.name)).toEqual(["Current"]);
    expect(publicProfile(me, { ...all, showCertifications: false }).certifications).toEqual([]);
  });
});
