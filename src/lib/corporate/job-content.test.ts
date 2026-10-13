import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { jobRequirements } from "@/lib/schemas";
import { JOB_REQUIRED_MAX } from "@/lib/schemas/constants";
import { requirementNames, requirementsFromRole, roleBySlug, roleOptions, skillOptions, unknownSkills } from "./job-content";

describe("jobs from role profiles", () => {
  it("start every role profile's job with requirements a job may have", () => {
    for (const role of roleProfiles) {
      const r = requirementsFromRole(role);
      expect(jobRequirements.safeParse(r).success, role.slug).toBe(true);
      expect(unknownSkills(r), role.slug).toEqual([]);
    }
  });

  it("keep at most 8 required skills, moving the rest to nice to have", () => {
    const role = roleBySlug("cyber-security-analyst")!;
    const solo = role.skills.filter((s) => s.importance === "required" && !s.oneOf).map((s) => s.skillId);
    expect(solo.length).toBeGreaterThan(JOB_REQUIRED_MAX);
    const r = requirementsFromRole(role);
    expect(r.required).toEqual(solo.slice(0, JOB_REQUIRED_MAX));
    expect(r.nice.slice(0, solo.length - JOB_REQUIRED_MAX)).toEqual(solo.slice(JOB_REQUIRED_MAX));
  });

  it("carry a role's one-of groups as groups", () => {
    const withGroup = roleProfiles.find((r) => r.groups.length > 0)!;
    const r = requirementsFromRole(withGroup);
    expect(r.oneOf.length).toBe(Math.min(withGroup.groups.length, 4));
    for (const g of r.oneOf) expect(g.length).toBeGreaterThanOrEqual(2);
  });

  it("find skills outside our taxonomy", () => {
    expect(unknownSkills({ required: ["siem", "made-up-skill"], oneOf: [], nice: [] })).toEqual(["made-up-skill"]);
  });

  it("list every role and skill for the form, and name skills for Departures", () => {
    expect(roleOptions().length).toBe(roleProfiles.length);
    expect(skillOptions().length).toBeGreaterThan(100);
    expect(requirementNames({ required: ["siem"], oneOf: [], nice: [] }).required[0]).not.toBe("siem");
  });
});
