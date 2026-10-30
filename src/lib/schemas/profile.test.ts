import { describe, expect, it } from "vitest";
import {
  PROFILE_HIGHLIGHT_MAX,
  PROFILE_HIGHLIGHTS_MAX,
  PROFILE_ROLES_MAX,
  PROFILE_SKILL_NAME_MAX,
  PROFILE_SKILLS_MAX,
  PROFILE_TEXT_MAX,
} from "./constants";
import { clampProfile, cutText, profile, storedProfile, type Profile } from "./profile";

const base: Profile = { headline: null, totalYearsExperience: null, roles: [], skills: [], education: [], certifications: [] };

describe("storedProfile", () => {
  it("reads certifications saved as plain names as undated", () => {
    const old = { ...base, certifications: ["CISSP, 2024", "AWS Cloud Practitioner"] } as unknown as Profile;
    const read = storedProfile(old);
    expect(read.certifications).toEqual([
      { name: "CISSP, 2024", earned: null, expires: null },
      { name: "AWS Cloud Practitioner", earned: null, expires: null },
    ]);
    expect(profile.safeParse(read).success).toBe(true);
  });

  it("leaves a current profile as it is", () => {
    const current = { ...base, certifications: [{ name: "CISSP", earned: "2024-03", expires: "none" as const }] };
    expect(storedProfile(current)).toBe(current);
  });
});

describe("profile certifications", () => {
  it("accepts YYYY or YYYY-MM dates and 'none' for no expiry, nothing else", () => {
    const ok = (earned: string | null, expires: string | null) =>
      profile.safeParse({ ...base, certifications: [{ name: "CISSP", earned, expires }] }).success;
    expect(ok("2024", "2027-03")).toBe(true);
    expect(ok(null, "none")).toBe(true);
    expect(ok("none", null)).toBe(false);
    expect(ok("March 2024", null)).toBe(false);
  });
});

describe("profile caps (T146)", () => {
  const role = { title: "Data Analyst", employer: "Example Ltd", start: "2023", end: null, highlights: ["Built a dashboard"] };
  const skill = { name: "SQL", lastUsed: null, evidence: ["Wrote SQL"] };

  it("refuses a field or a list past its cap", () => {
    expect(profile.safeParse({ ...base, roles: [{ ...role, title: "x".repeat(PROFILE_TEXT_MAX + 1) }] }).success).toBe(false);
    expect(profile.safeParse({ ...base, roles: [{ ...role, highlights: ["x".repeat(PROFILE_HIGHLIGHT_MAX + 1)] }] }).success).toBe(false);
    expect(profile.safeParse({ ...base, skills: Array.from({ length: PROFILE_SKILLS_MAX + 1 }, (_, i) => ({ ...skill, name: `S${i}` })) }).success).toBe(false);
    expect(profile.safeParse({ ...base, roles: [role], skills: [skill] }).success).toBe(true);
  });

  it("cuts an oversize profile to fit instead of refusing it, and leaves one inside the caps alone", () => {
    const big: Profile = {
      ...base,
      headline: "h".repeat(60_000),
      roles: Array.from({ length: PROFILE_ROLES_MAX + 5 }, () => ({ ...role, highlights: Array(PROFILE_HIGHLIGHTS_MAX + 3).fill("y".repeat(400)) })),
      skills: Array.from({ length: 1_600 }, (_, i) => ({ ...skill, name: `${i}${"z".repeat(200)}` })),
    };
    const cut = clampProfile(big);
    expect(profile.safeParse(cut).success).toBe(true);
    expect(cut.roles).toHaveLength(PROFILE_ROLES_MAX);
    expect(cut.roles[0].highlights).toHaveLength(PROFILE_HIGHLIGHTS_MAX);
    expect(cut.skills).toHaveLength(PROFILE_SKILLS_MAX);
    expect(cut.skills[0].name).toBe(`0${"z".repeat(PROFILE_SKILL_NAME_MAX - 1)}`);
    const small = { ...base, roles: [role], skills: [skill] };
    expect(clampProfile(small)).toBe(small);
  });

  it("never splits an emoji when it cuts", () => {
    expect(cutText(`${"a".repeat(PROFILE_TEXT_MAX - 1)}😀`, PROFILE_TEXT_MAX)).toBe("a".repeat(PROFILE_TEXT_MAX - 1));
  });

  it("reads an older oversize save cut to fit, so the editor can save it back", () => {
    const old = { ...base, roles: [{ ...role, employer: "e".repeat(500) }] };
    const read = storedProfile(old);
    expect(read.roles[0].employer).toHaveLength(PROFILE_TEXT_MAX);
    expect(profile.safeParse(read).success).toBe(true);
  });
});
