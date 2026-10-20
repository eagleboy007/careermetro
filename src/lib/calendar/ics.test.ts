import { describe, expect, it } from "vitest";
import { escapeIcsText, eveningBefore, foldIcsLine, icsUtc, interviewIcs } from "./ics";

const iv = {
  interviewId: "6f1c2a9e-0b1d-4c3e-9f00-1234567890ab",
  // Wed 14 Oct, 11:00 India time.
  startsAt: new Date("2026-10-14T05:30:00.000Z"),
  minutes: 45,
  summary: "Level 2 team interview for SOC Analyst L1 at Example Labs",
  now: new Date("2026-10-12T10:00:00.000Z"),
};

describe("interview calendar file", () => {
  it("escapes backslashes, semicolons, commas and line breaks", () => {
    expect(escapeIcsText("A, B; C\\D\nE\r\nF")).toBe("A\\, B\\; C\\\\D\\nE\\nF");
  });

  it("writes UTC date-times", () => {
    expect(icsUtc(new Date("2026-10-14T05:30:00.000Z"))).toBe("20261014T053000Z");
  });

  it("puts the reminder at 19:00 India time the evening before, across a month end", () => {
    expect(eveningBefore(iv.startsAt).toISOString()).toBe("2026-10-13T13:30:00.000Z");
    // 00:30 India time on 1 Nov is still 31 Oct in UTC; the reminder is 19:00 India time on 31 Oct.
    expect(eveningBefore(new Date("2026-10-31T19:00:00.000Z")).toISOString()).toBe("2026-10-31T13:30:00.000Z");
  });

  it("builds one event with CRLF lines, a stable UID, the times, and the evening reminder", () => {
    const ics = interviewIcs(iv);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    const lines = ics.replace(/\r\n /g, "").split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("UID:interview-6f1c2a9e-0b1d-4c3e-9f00-1234567890ab@careermetro.app");
    expect(lines).toContain("DTSTAMP:20261012T100000Z");
    expect(lines).toContain("DTSTART:20261014T053000Z");
    expect(lines).toContain("DTEND:20261014T061500Z");
    expect(lines).toContain("SUMMARY:Level 2 team interview for SOC Analyst L1 at Example Labs");
    expect(lines).toContain("TRIGGER;VALUE=DATE-TIME:20261013T133000Z");
    expect(lines.filter((l) => l === "BEGIN:VALARM")).toHaveLength(1);
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    // The same interview gives the same UID on a later download.
    expect(interviewIcs({ ...iv, now: new Date("2026-10-13T00:00:00.000Z") })).toContain("UID:interview-6f1c2a9e-0b1d-4c3e-9f00-1234567890ab@careermetro.app");
  });

  it("escapes the company and title, and holds nothing else about the person", () => {
    const ics = interviewIcs({ ...iv, summary: "Level 2 team interview for Analyst, payments at Sample; Fintech" });
    expect(ics.replace(/\r\n /g, "")).toContain("SUMMARY:Level 2 team interview for Analyst\\, payments at Sample\\; Fintech");
    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|mailto:|TEL/);
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const long = "SUMMARY:" + "भारत ".repeat(30);
    const folded = foldIcsLine(long);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    expect(foldIcsLine("VERSION:2.0")).toBe("VERSION:2.0");
  });
});
