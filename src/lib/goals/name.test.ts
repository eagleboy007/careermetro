import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { goalName } from "./name";

const role = roleProfiles.find((r) => r.groups.length)!;
const group = role.groups[0];

describe("goalName", () => {
  it("shows a proved group goal under the group's label, not the suggested skill", () => {
    expect(goalName({ skillName: "AWS", groupId: group.id }, true, role.slug)).toBe(group.label);
  });

  it("keeps the gap's name before proof, and for goals outside a group", () => {
    expect(goalName({ skillName: "AWS", groupId: group.id }, false, role.slug)).toBe("AWS");
    expect(goalName({ skillName: "SQL" }, true, role.slug)).toBe("SQL");
    expect(goalName({ skillName: "AWS", groupId: "unknown" }, true, role.slug)).toBe("AWS");
  });
});
