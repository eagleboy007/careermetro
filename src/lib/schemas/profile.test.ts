import { describe, expect, it } from "vitest";
import { profile, storedProfile, type Profile } from "./profile";

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
