import { describe, expect, it } from "vitest";
import { countdownWords, daysUntil, gapCount, interviewWhen, leadLine, leadSkills, minuteValue, nowDate } from "./view";

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

  it("names only skills on today's ride: today's goal, and another open skill only when the ride holds it too (T155)", () => {
    // Today's ride is one goal, so the job's other open goals are left out.
    expect(leadSkills(open, ["threat-detection"])).toEqual(["Threat detection"]);
    expect(leadLine(leadSkills(open, ["siem"]))).toBe("Its still-open skill, SIEM, leads today's ride.");
    // A ride that holds two of the job's open skills names both, today's goal first, two at most.
    expect(leadSkills(open, ["threat-detection", "siem", "python"])).toEqual(["Threat detection", "SIEM"]);
    expect(leadLine(leadSkills(open, ["siem", "threat-detection"]))).toBe("Its still-open skills, SIEM and Threat detection, lead today's ride.");
  });

  it("says nothing when today's goal is not one of the job's open skills, or the job has none", () => {
    expect(leadSkills(open, ["power-bi"])).toEqual([]);
    expect(leadSkills(open, ["power-bi", "siem"])).toEqual([]);
    expect(leadSkills(open, [])).toEqual([]);
    expect(leadSkills([], ["siem"])).toEqual([]);
    expect(leadLine([])).toBeNull();
  });
});

describe("the folded My jobs row on a phone (C24)", () => {
  const base = { status: "saved" as const, savedAt: "2026-10-27T06:00:00.000Z", appliedAt: null, closedAt: null, interviewAt: null };

  it("shows the one date that matters now", () => {
    expect(nowDate(base)).toEqual({ label: "Saved", day: "27 Oct" });
    expect(nowDate({ ...base, status: "applied", appliedAt: "2026-10-21T06:00:00.000Z" })).toEqual({ label: "Applied", day: "21 Oct" });
    expect(nowDate({ ...base, status: "interview", appliedAt: "2026-10-21T06:00:00.000Z", interviewAt: "2026-10-30T05:00:00.000Z" })).toEqual({
      label: "Interview",
      day: "Fri 30 Oct, 10:30",
    });
  });

  it("shows a closed row's status and day, never its old interview", () => {
    const closed = { ...base, appliedAt: "2026-10-21T06:00:00.000Z", interviewAt: "2026-10-30T05:00:00.000Z", closedAt: "2026-10-24T06:00:00.000Z" };
    expect(nowDate({ ...closed, status: "no" })).toEqual({ label: "Not this time", day: "24 Oct" });
    expect(nowDate({ ...closed, status: "withdrawn" })).toEqual({ label: "Withdrawn", day: "24 Oct" });
    expect(nowDate({ ...closed, status: "no", closedAt: null })).toEqual({ label: "Applied", day: "21 Oct" });
  });

  it("shows nothing without a date", () => {
    expect(nowDate({ ...base, savedAt: null })).toBeNull();
  });

  it("counts the gaps in words", () => {
    const gap = { status: "missing" as const, name: "SQL" };
    expect([[], [gap], [gap, gap]].map((open) => gapCount({ open }))).toEqual(["no gaps", "1 gap", "2 gaps"]);
  });
});
