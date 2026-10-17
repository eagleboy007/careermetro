import { describe, expect, it } from "vitest";
import { skillGroupMembers } from "@/content";
import { canSwapTo, notForMeFor, shareSentence, swappedSkill } from "./not-for-me";

const required = { source: "gap" as const, skillId: "sql", groupId: null };
const cloud = { source: "gap" as const, skillId: "aws", groupId: "cloud" };

describe("Not for me (FR-48)", () => {
  it("offers a skip on a required goal, with how many of the role's posts ask for it", () => {
    expect(notForMeFor(required, "data-analyst", skillGroupMembers)).toEqual({ kind: "skip", share: 0.91 });
    expect(shareSentence(0.91)).toBe("Asked for in 91% of the job posts we checked for this role.");
    // Not measured, or measured as none, says nothing about posts.
    expect(notForMeFor({ ...required, skillId: "application-security" }, "appsec-engineer", skillGroupMembers)).toEqual({ kind: "skip", share: null });
    expect(notForMeFor(required, "no-such-role", skillGroupMembers)).toEqual({ kind: "skip", share: null });
    expect(shareSentence(null)).toBeNull();
  });

  it("offers a swap to the other skills of a group goal, and nothing on a Your choice goal", () => {
    const offer = notForMeFor(cloud, "cloud-engineer", skillGroupMembers);
    expect(offer).toMatchObject({ kind: "swap", current: "aws" });
    expect(offer?.kind === "swap" && offer.options.map((o) => o.skillId).sort()).toEqual(["azure", "gcp"]);
    expect(offer?.kind === "swap" && offer.options.every((o) => o.name && o.name !== o.skillId)).toBe(true);
    expect(notForMeFor({ ...cloud, swappedTo: "gcp" }, "cloud-engineer", skillGroupMembers)).toMatchObject({ kind: "swap", current: "gcp" });
    expect(notForMeFor({ ...required, source: "user" }, "data-analyst", skillGroupMembers)).toBeNull();
  });

  it("swaps only within the goal's own group, and ignores a swap the group no longer has", () => {
    expect(canSwapTo(cloud, "gcp", skillGroupMembers)).toBe(true);
    // Back to the goal's own skill is allowed: it clears the swap.
    expect(canSwapTo(cloud, "aws", skillGroupMembers)).toBe(true);
    expect(canSwapTo(cloud, "sql", skillGroupMembers)).toBe(false);
    expect(canSwapTo(required, "excel", skillGroupMembers)).toBe(false);
    expect(canSwapTo({ ...cloud, source: "user" }, "gcp", skillGroupMembers)).toBe(false);
    expect(swappedSkill({ ...cloud, swappedTo: "gcp" }, skillGroupMembers)).toBe("gcp");
    expect(swappedSkill({ ...cloud, swappedTo: "aws" }, skillGroupMembers)).toBeNull();
    // A goal that left its group (a new role needs the skill itself) learns its own skill again.
    expect(swappedSkill({ ...cloud, groupId: null, swappedTo: "gcp" }, skillGroupMembers)).toBeNull();
    expect(swappedSkill({ ...cloud, swappedTo: "sql" }, skillGroupMembers)).toBeNull();
  });
});
