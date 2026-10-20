import { describe, expect, it } from "vitest";
import { planView } from "@/lib/schemas";
import { badgeOn, ELITE_MESSAGES, isElite, planViewOf, practiceCapFor, switchedPlan } from "./rules";

const now = new Date("2026-10-20T10:00:00Z");
const before = new Date("2026-10-19T06:00:00Z");

describe("Elite rules (FR-50)", () => {
  it("reads no row, and a row without a start date, as Free", () => {
    expect(isElite(null)).toBe(false);
    expect(isElite(undefined)).toBe(false);
    expect(isElite({ eliteSince: null, badgeShown: true })).toBe(false);
    expect(isElite({ eliteSince: now, badgeShown: false })).toBe(true);
  });

  it("shows the badge only while Elite is on and the person turned it on", () => {
    expect(badgeOn({ eliteSince: now, badgeShown: false })).toBe(false);
    expect(badgeOn({ eliteSince: null, badgeShown: true })).toBe(false);
    expect(badgeOn({ eliteSince: now, badgeShown: true })).toBe(true);
  });

  it("gives the screens a plan that passes its schema, with the India date", () => {
    expect(planViewOf(null)).toEqual({ elite: false, badgeShown: false, since: null });
    const on = planViewOf({ eliteSince: before, badgeShown: true });
    expect(on).toEqual({ elite: true, badgeShown: true, since: "19 Oct 2026" });
    expect(planView.safeParse(on).success).toBe(true);
    expect(planView.safeParse(planViewOf({ eliteSince: null, badgeShown: true })).success).toBe(true);
  });

  it("keeps the first date when turned on again, and turning off goes back to Free with the badge off", () => {
    expect(switchedPlan(null, true, now)).toEqual({ eliteSince: now, badgeShown: false });
    expect(switchedPlan({ eliteSince: before, badgeShown: true }, true, now)).toEqual({ eliteSince: before, badgeShown: true });
    expect(switchedPlan({ eliteSince: before, badgeShown: true }, false, now)).toEqual({ eliteSince: null, badgeShown: false });
    expect(switchedPlan(null, false, now)).toEqual({ eliteSince: null, badgeShown: false });
  });

  it("caps Practice at 10 answers a day on Free only", () => {
    expect(practiceCapFor(false)).toBe(10);
    expect(practiceCapFor(true)).toBeNull();
  });

  it("tells a Free person to turn on Elite, and says the daily limit in words", () => {
    expect(ELITE_MESSAGES.not_elite).toBe("Turn on Elite to use this.");
    expect(ELITE_MESSAGES.limit).toBe("That's as many changes as we allow in a day. Try again tomorrow.");
  });
});
