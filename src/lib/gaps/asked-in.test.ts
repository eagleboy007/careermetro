import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import type { RoleProfile } from "@/lib/schemas";
import { askedInLabel, askedInForGap, postingShares } from "./asked-in";

const role = (skills: Partial<RoleProfile["skills"][number]>[], groups: RoleProfile["groups"] = []) =>
  ({
    skills: skills.map((s) => ({ importance: "required", expectation: "x", postingShare: null, ...s })),
    groups,
  }) as Pick<RoleProfile, "skills" | "groups">;

describe("askedInLabel", () => {
  it("says how many of 10 postings ask for a skill, rounded", () => {
    expect(askedInLabel(0.91)).toBe("Asked in 9 of 10 postings");
    expect(askedInLabel(0.66)).toBe("Asked in 7 of 10 postings");
    expect(askedInLabel(1)).toBe("Asked in 10 of 10 postings");
    expect(askedInLabel(0.05)).toBe("Asked in 1 of 10 postings");
  });

  it("says fewer than 1 in 10 for a measured share that rounds to nothing", () => {
    expect(askedInLabel(0.03)).toBe("Asked in fewer than 1 of 10 postings");
    expect(askedInLabel(0)).toBe("Asked in fewer than 1 of 10 postings");
  });

  it("says nothing without a measured share, rather than guess", () => {
    expect(askedInLabel(null)).toBeNull();
    expect(askedInLabel(undefined)).toBeNull();
    expect(askedInLabel(Number.NaN)).toBeNull();
    expect(askedInLabel(1.2)).toBeNull();
  });
});

describe("postingShares and askedInForGap", () => {
  it("reads each measured skill's share, and a group's as its most asked skill", () => {
    const shares = postingShares(
      role(
        [
          { skillId: "sql", postingShare: 0.9 },
          { skillId: "storytelling", postingShare: null },
          { skillId: "aws", postingShare: 0.4, oneOf: "cloud" },
          { skillId: "azure", postingShare: 0.6, oneOf: "cloud" },
          { skillId: "gcp", postingShare: null, oneOf: "cloud" },
        ],
        [{ id: "cloud", label: "A cloud platform" }],
      ),
    );
    expect(askedInForGap({ skillId: "sql" }, shares)).toBe("Asked in 9 of 10 postings");
    expect(askedInForGap({ skillId: "storytelling" }, shares)).toBeNull();
    expect(askedInForGap({ skillId: "unknown" }, shares)).toBeNull();
    // A group gap names its suggested skill; the group counts at its most asked member.
    expect(askedInForGap({ skillId: "aws", groupId: "cloud" }, shares)).toBe("Asked in 6 of 10 postings");
  });

  it("finds data only for roles measured on postings", () => {
    const measured = roleProfiles.filter((r) => r.skills.some((s) => s.postingShare !== null));
    expect(measured.length).toBeGreaterThan(0);
    for (const r of roleProfiles) {
      const shares = postingShares(r);
      const labels = r.skills.map((s) => askedInForGap({ skillId: s.skillId, groupId: s.oneOf }, shares));
      if (!measured.includes(r)) expect(labels.every((l) => l === null)).toBe(true);
    }
    const da = postingShares(roleProfiles.find((r) => r.slug === "data-analyst")!);
    expect(askedInForGap({ skillId: "sql" }, da)).toMatch(/^Asked in \d+ of 10 postings$/);
  });
});
