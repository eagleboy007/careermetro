import { describe, expect, it } from "vitest";
import { phoneKeySecret } from "@/lib/hash-keys";
import { decryptPhone, encryptPhone, phoneSharingAvailable } from "./phone";
import { canCancel, canRespond, feedbackRefusal, phoneVisible, scheduleRefusal, shownStatus } from "./rules";
import { askDays, askText, dayParts, daysBetween, nextDays, slotKeyOf, slotLabel, slotOpen, slotStart, timeRange } from "./slots";

// Interviews (dev/corporate-plan.md build step 6): the pure rules and India-time helpers.
const NOW = new Date("2026-10-13T04:30:00Z"); // Tue 13 Oct, 10:00 in India
const HOUR = 3600_000;

describe("interview times, in India time", () => {
  it("ask for the next five weekdays after today, skipping the weekend", () => {
    expect(askDays(NOW)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
    // 23:00 on Friday in India is still Friday there, though it is Friday afternoon in UTC.
    expect(askDays(new Date("2026-10-16T17:30:00Z"))).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    // 00:30 on Saturday in India is Friday in UTC: the ask still starts on Monday.
    expect(askDays(new Date("2026-10-16T19:00:00Z"))[0]).toBe("2026-10-19");
  });

  it("turn a picker key into its instant and back, refusing times not on the picker", () => {
    const at = slotStart("2026-10-14T11:00")!;
    expect(at.toISOString()).toBe("2026-10-14T05:30:00.000Z");
    expect(slotKeyOf(at)).toBe("2026-10-14T11:00");
    expect(slotStart("2026-10-14T13:00")).toBeNull();
    expect(slotStart("2026-02-30T11:00")).toBeNull();
    expect(slotStart("14 Oct 11:00")).toBeNull();
  });

  it("label days and slots the way people read them", () => {
    expect(dayParts("2026-10-14")).toEqual(["Wed", "14 Oct"]);
    expect(slotLabel(slotStart("2026-10-14T18:00")!)).toBe("Wed 14 Oct, 18:00");
    expect(timeRange(slotStart("2026-10-14T11:00")!, 45)).toBe("11:00 to 11:45");
    expect(askText(askDays(NOW))).toMatch(/^Which times work for you between Wed 14 Oct and Tue 20 Oct\?/);
    expect(daysBetween("2026-10-13", "2026-10-16")).toBe(3);
    expect(nextDays("2026-10-30", 3)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("offer and book only times at least two hours ahead", () => {
    expect(slotOpen(new Date(NOW.getTime() + 2 * HOUR), NOW)).toBe(true);
    expect(slotOpen(new Date(NOW.getTime() + HOUR), NOW)).toBe(false);
    expect(slotOpen(new Date(NOW.getTime() - HOUR), NOW)).toBe(false);
  });
});

describe("interview rules", () => {
  const app = { stage: "shortlisted" as const, withdrawn: false, jobStatus: "open" as const };
  it("let only the job team of a verified company book, for an open application", () => {
    expect(scheduleRefusal({ role: "admin", teamRole: null, orgStatus: "verified", app })).toBeNull();
    expect(scheduleRefusal({ role: "hiring", teamRole: "hiring", orgStatus: "verified", app })).toBeNull();
    expect(scheduleRefusal({ role: "hiring", teamRole: null, orgStatus: "verified", app })).toBe("not_allowed");
    expect(scheduleRefusal({ role: "hiring", teamRole: "interviewer", orgStatus: "verified", app })).toBe("not_allowed");
    expect(scheduleRefusal({ role: "interviewer", teamRole: "interviewer", orgStatus: "verified", app })).toBe("read_only");
    expect(scheduleRefusal({ role: "admin", teamRole: null, orgStatus: "suspended", app })).toBe("suspended");
    expect(scheduleRefusal({ role: "admin", teamRole: null, orgStatus: "pending", app })).toBe("suspended");
    expect(scheduleRefusal({ role: "admin", teamRole: null, orgStatus: "verified", app: { ...app, stage: "not_this_time" } })).toBe("closed");
    expect(scheduleRefusal({ role: "admin", teamRole: null, orgStatus: "verified", app: { ...app, withdrawn: true } })).toBe("closed");
    expect(scheduleRefusal({ role: "admin", teamRole: null, orgStatus: "verified", app: { ...app, jobStatus: "closed" } })).toBe("closed");
  });

  it("read an accepted interview as done once its time is over", () => {
    const startsAt = new Date(NOW.getTime() - HOUR);
    expect(shownStatus({ status: "accepted", startsAt, minutes: 45 }, NOW)).toBe("done");
    expect(shownStatus({ status: "accepted", startsAt, minutes: 90 }, NOW)).toBe("accepted");
    expect(shownStatus({ status: "proposed", startsAt, minutes: 45 }, NOW)).toBe("proposed");
  });

  it("let the candidate answer only a proposed interview that hasn't started; the team cancel only one still ahead", () => {
    const ahead = new Date(NOW.getTime() + HOUR);
    const past = new Date(NOW.getTime() - HOUR);
    expect(canRespond({ status: "proposed", startsAt: ahead }, NOW)).toBe(true);
    expect(canRespond({ status: "proposed", startsAt: past }, NOW)).toBe(false);
    expect(canRespond({ status: "accepted", startsAt: ahead }, NOW)).toBe(false);
    expect(canCancel({ status: "accepted", startsAt: ahead }, NOW)).toBe(true);
    expect(canCancel({ status: "declined", startsAt: ahead }, NOW)).toBe(false);
    expect(canCancel({ status: "accepted", startsAt: past }, NOW)).toBe(false);
  });

  it("take feedback only from an interviewer on an accepted interview", () => {
    expect(feedbackRefusal({ assigned: true, status: "accepted" })).toBeNull();
    expect(feedbackRefusal({ assigned: true, status: "done" })).toBeNull();
    expect(feedbackRefusal({ assigned: true, status: "proposed" })).toBe("not_accepted");
    expect(feedbackRefusal({ assigned: false, status: "accepted" })).toBe("not_assigned");
  });

  it("show a shared phone only to that interview's team, and only while the application is open", () => {
    expect(phoneVisible({ canMove: true, assignedToShared: false, anyShared: true, closed: false })).toBe(true);
    expect(phoneVisible({ canMove: false, assignedToShared: true, anyShared: true, closed: false })).toBe(true);
    expect(phoneVisible({ canMove: false, assignedToShared: false, anyShared: true, closed: false })).toBe(false);
    expect(phoneVisible({ canMove: true, assignedToShared: false, anyShared: false, closed: false })).toBe(false);
    expect(phoneVisible({ canMove: true, assignedToShared: true, anyShared: true, closed: true })).toBe(false);
  });
});

describe("a shared phone at rest", () => {
  const env = { NAME_HASH_KEY: "test-key" };
  const APP = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";
  it("is encrypted for one application, reads back with the same key only, and never the same twice", () => {
    const a = encryptPhone("+91 98765 43210", APP, env)!;
    expect(a).toMatch(/^v2:/);
    expect(a).not.toContain("98765");
    expect(a).not.toBe(encryptPhone("+91 98765 43210", APP, env));
    expect(decryptPhone(a, APP, env)).toBe("+91 98765 43210");
    expect(decryptPhone(a, APP, { NAME_HASH_KEY: "other" })).toBeNull();
    // Copied to another application, it doesn't open.
    expect(decryptPhone(a, "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72", env)).toBeNull();
    expect(decryptPhone(`${a.slice(0, -2)}xx`, APP, env)).toBeNull();
    // A short IV or tag is refused.
    const [iv, tag, body] = a.slice(3).split(".");
    expect(decryptPhone(`v2:${iv!.slice(0, 8)}.${tag}.${body}`, APP, env)).toBeNull();
    expect(decryptPhone(`v2:${iv}.${tag!.slice(0, 8)}.${body}`, APP, env)).toBeNull();
    expect(decryptPhone(null, APP, env)).toBeNull();
    expect(decryptPhone("+91 98765 43210", APP, env)).toBeNull();
  });

  it("has no key in production without PHONE_KEY or NAME_HASH_KEY: sharing is off, nothing seals or opens", () => {
    const a = encryptPhone("+91 98765 43210", APP, { CRON_SECRET: "c" })!;
    for (const prod of [{ VERCEL_ENV: "production" }, { NODE_ENV: "production" }]) {
      const off = { ...prod, CRON_SECRET: "c" };
      expect(phoneKeySecret(off)).toBeNull();
      expect(phoneSharingAvailable(off)).toBe(false);
      expect(encryptPhone("+91 98765 43210", APP, off)).toBeNull();
      expect(decryptPhone(a, APP, off)).toBeNull();
      expect(phoneSharingAvailable({ ...off, PHONE_KEY: "k" })).toBe(true);
      expect(phoneSharingAvailable({ ...off, NAME_HASH_KEY: "k" })).toBe(true);
    }
    // PHONE_KEY wins over NAME_HASH_KEY.
    expect(phoneKeySecret({ PHONE_KEY: "p", NAME_HASH_KEY: "n" })).toBe("phone|p");
    expect(phoneSharingAvailable({ VERCEL_ENV: "preview" })).toBe(true);
  });
});
