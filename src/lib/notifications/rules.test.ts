import { describe, expect, it } from "vitest";
import { bellLabel, hrefFor, relativeTime, sentenceFor, type NotificationFacts } from "./rules";

const base: NotificationFacts = { kind: "connection_request", actorName: "Ravi Menon", actorHandle: "ravi-m", company: null, job: null, stage: null, startsAt: null };
const job = { company: "Example Labs", job: "SOC Analyst L1" };

describe("sentenceFor and hrefFor", () => {
  it("words each kind as the plan does, and links where it says", () => {
    expect(sentenceFor(base)).toBe("Ravi Menon asked to connect.");
    expect(hrefFor(base)).toBe("/network?tab=requests");
    const accepted = { ...base, kind: "connection_accepted" as const };
    expect(sentenceFor(accepted)).toBe("Ravi Menon accepted your request. You can message them now.");
    expect(hrefFor(accepted)).toBe("/u/ravi-m");
    expect(hrefFor({ ...accepted, actorHandle: null })).toBe("/network");
    const moved = { ...base, ...job, kind: "application_moved" as const, stage: "shortlisted" as const };
    expect(sentenceFor(moved)).toBe("Example Labs moved your application for SOC Analyst L1 to Shortlisted.");
    expect(hrefFor(moved)).toBe("/arrivals");
    expect(sentenceFor({ ...base, ...job, kind: "application_closed" })).toBe("Example Labs closed your application for SOC Analyst L1. Their note is on Arrivals.");
    // 11:00 India time on Wednesday 14 October.
    const set = { ...base, ...job, kind: "interview_scheduled" as const, startsAt: new Date("2026-10-14T05:30:00Z") };
    expect(sentenceFor(set)).toBe("Example Labs set an interview for SOC Analyst L1: Wed 14 Oct, 11:00 IST.");
    expect(sentenceFor({ ...base, ...job, kind: "interview_cancelled" })).toBe("Example Labs cancelled the interview for SOC Analyst L1.");
  });

  it("reads the stage live, so a move whose application has since closed reads as closed", () => {
    expect(sentenceFor({ ...base, ...job, kind: "application_moved", stage: "not_this_time" })).toBe(
      "Example Labs closed your application for SOC Analyst L1. Their note is on Arrivals.",
    );
  });
});

describe("relativeTime", () => {
  // 20 October 2026, 15:30 India time.
  const now = new Date("2026-10-20T10:00:00Z");
  const ago = (ms: number) => relativeTime(new Date(now.getTime() - ms), now);
  it("says minutes, hours, Yesterday and days, by India day", () => {
    expect(ago(20_000)).toBe("Just now");
    expect(ago(5 * 60_000)).toBe("5 min ago");
    expect(ago(2 * 3600_000)).toBe("2 h ago");
    expect(ago(20 * 3600_000)).toBe("Yesterday");
    expect(ago(4 * 86_400_000)).toBe("4 days ago");
    // A time ahead (clock skew) reads as just now.
    expect(ago(-60_000)).toBe("Just now");
  });
});

describe("bellLabel", () => {
  it("is the prototype's label", () => {
    expect(bellLabel(2)).toBe("Notifications, 2 new");
    expect(bellLabel(0)).toBe("Notifications");
  });
});
