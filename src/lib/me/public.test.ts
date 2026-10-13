import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/schemas";
import { exampleMe } from "./fixtures";
import type { MeProfile } from "@/lib/schemas";
import { PUBLIC_KEYS, publicProfile } from "./public";

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
    expect(out.certifications).toEqual(me.certifications);
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
    const withMore = { ...me, nearby: [{ title: "BI Analyst" }], changeRoleHref: "/resume/x/role" } as MeProfile;
    const out = publicProfile(withMore, all) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(allowed);
    expect(out.nearby ?? null).toBeNull();
    expect(out.changeRoleHref ?? null).toBeNull();
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
