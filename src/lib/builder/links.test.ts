import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { profileLinkOrder } from "./links";
import { builderRoleLinks } from "./roles";

describe("profileLinkOrder (T182)", () => {
  it("puts LinkedIn first with no role", () => {
    expect(profileLinkOrder()).toEqual(["linkedin", "portfolio", "github"]);
    expect(profileLinkOrder([])).toEqual(["linkedin", "portfolio", "github"]);
  });

  it("puts GitHub first when any required skill is code", () => {
    expect(profileLinkOrder(["business", "programming"])).toEqual(["github", "linkedin", "portfolio"]);
    expect(profileLinkOrder(["cloud-devops", "tools"])).toEqual(["github", "linkedin", "portfolio"]);
    expect(profileLinkOrder(["web"])).toEqual(["github", "linkedin", "portfolio"]);
  });

  it("puts the portfolio first when most required skills are design", () => {
    expect(profileLinkOrder(["design", "design", "workplace"])).toEqual(["portfolio", "linkedin", "github"]);
    expect(profileLinkOrder(["design", "business", "marketing"])).toEqual(["linkedin", "portfolio", "github"]);
  });

  it("puts LinkedIn first for business, marketing and workplace skills", () => {
    expect(profileLinkOrder(["business", "tools", "workplace", "marketing"])).toEqual(["linkedin", "portfolio", "github"]);
  });
});

describe("builderRoleLinks (T182)", () => {
  it("has an order for every role, each with all three links once", () => {
    for (const r of roleProfiles) expect([...(builderRoleLinks[r.slug] ?? [])].sort(), r.slug).toEqual(["github", "linkedin", "portfolio"]);
  });

  it("puts GitHub first for a DevOps role, the portfolio first for UI/UX and LinkedIn first for finance and HR roles", () => {
    expect(builderRoleLinks["devops-engineer"][0]).toBe("github");
    expect(builderRoleLinks["ui-ux-designer"][0]).toBe("portfolio");
    expect(builderRoleLinks["financial-analyst"][0]).toBe("linkedin");
    expect(builderRoleLinks["hr-generalist"][0]).toBe("linkedin");
    expect(builderRoleLinks["accounts-executive"][0]).toBe("linkedin");
  });
});
