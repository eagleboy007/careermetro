import { describe, expect, it } from "vitest";
import { ELITE_CHANGES_PER_DAY, ELITE_NEEDED_MESSAGE, eliteBadgeInput, eliteSwitchInput, planRow, planView } from "./index";

describe("Elite schemas (FR-50)", () => {
  it("takes only true or false from the switches", () => {
    expect(eliteSwitchInput.parse(true)).toBe(true);
    expect(eliteSwitchInput.parse(false)).toBe(false);
    expect(eliteSwitchInput.safeParse("true").success).toBe(false);
    expect(eliteSwitchInput.safeParse(1).success).toBe(false);
    expect(eliteBadgeInput.safeParse(null).success).toBe(false);
  });

  it("stores Free as no start date, and nothing about money", () => {
    expect(planRow.parse({ eliteSince: null, badgeShown: false })).toEqual({ eliteSince: null, badgeShown: false });
    expect(planRow.safeParse({ eliteSince: null, badgeShown: false, priceId: "p_1" }).success).toBe(false);
  });

  it("never shows a badge or a start date on Free, and Elite always has a start date", () => {
    expect(planView.safeParse({ elite: false, badgeShown: false, since: null }).success).toBe(true);
    expect(planView.safeParse({ elite: true, badgeShown: true, since: "19 Oct 2026" }).success).toBe(true);
    expect(planView.safeParse({ elite: false, badgeShown: true, since: null }).success).toBe(false);
    expect(planView.safeParse({ elite: false, badgeShown: false, since: "19 Oct 2026" }).success).toBe(false);
    expect(planView.safeParse({ elite: true, badgeShown: false, since: null }).success).toBe(false);
  });

  it("limits changes to 10 a day and tells a Free person what to do", () => {
    expect(ELITE_CHANGES_PER_DAY).toBe(10);
    expect(ELITE_NEEDED_MESSAGE).toBe("Turn on Elite to use this.");
  });
});
