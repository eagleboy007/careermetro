import { describe, expect, it } from "vitest";
import { countdownWords, daysUntil, interviewWhen, leadLine, leadSkills, minuteValue } from "./view";

describe("the interview in IST (handoff 12m)", () => {
  const at = "2026-10-30T05:00:00.000Z"; // 10:30 IST on Friday 30 October

  it("fills the date and time field in IST", () => {
    expect(minuteValue(at)).toBe("2026-10-30T10:30");
    expect(minuteValue(null)).toBe("");
  });

  it("shows the day and time in IST", () => {
    expect(interviewWhen(at)).toBe("Fri 30 Oct, 10:30");
    expect(interviewWhen("2026-10-30T19:00:00.000Z")).toBe("Sat 31 Oct, 00:30");
  });

  it("counts India days, not 24-hour spans", () => {
    expect(daysUntil(at, new Date("2026-10-30T01:00:00.000Z"))).toBe(0);
    // 23:00 IST the evening before is one day out, though only 11.5 hours remain.
    expect(daysUntil(at, new Date("2026-10-29T17:30:00.000Z"))).toBe(1);
    // 00:30 IST on the 30th, still 29 October in UTC, is already the day.
    expect(daysUntil(at, new Date("2026-10-29T19:00:00.000Z"))).toBe(0);
    expect(daysUntil(at, new Date("2026-10-27T05:00:00.000Z"))).toBe(3);
  });

  it("says the countdown in words", () => {
    expect([0, 1, 3].map(countdownWords)).toEqual(["today", "tomorrow", "in 3 days"]);
  });
});

describe("the still-open skills that lead today's ride (C20)", () => {
  const open = [
    { skillId: "siem", skillName: "SIEM" },
    { skillId: "threat-detection", skillName: "Threat detection" },
    { skillId: "python", skillName: "Python" },
  ];

  it("names today's goal first, then the job's other open goals, two at most", () => {
    expect(leadSkills(open, { skillId: "threat-detection" })).toEqual(["Threat detection", "SIEM"]);
    expect(leadLine(leadSkills(open, { skillId: "siem" }))).toBe("Its still-open skills, SIEM and Threat detection, lead today's ride.");
    expect(leadLine(["SIEM"])).toBe("Its still-open skill, SIEM, leads today's ride.");
  });

  it("says nothing when today's ride is not on one of the job's open skills, or the job has none", () => {
    expect(leadSkills(open, { skillId: "power-bi" })).toEqual([]);
    expect(leadSkills(open, null)).toEqual([]);
    expect(leadSkills([], { skillId: "siem" })).toEqual([]);
    expect(leadLine([])).toBeNull();
  });
});
