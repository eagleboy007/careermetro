import { describe, expect, it } from "vitest";
import { askTimesInput, feedbackInput, indianMobile, interviewIdInput, offerTimesInput, respondInput, scheduleInput } from "@/lib/schemas";

const ID = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";
const ID2 = "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";

describe("interview schemas (corporate build step 6)", () => {
  it("ask for times names only the application", () => {
    expect(askTimesInput.parse({ applicationId: ID, body: "anything", days: ["2026-01-01"] })).toEqual({ applicationId: ID });
    expect(askTimesInput.safeParse({ applicationId: "x" }).success).toBe(false);
  });

  it("take offered times as picker keys, each once, one to twelve", () => {
    expect(offerTimesInput.parse({ messageId: ID, slots: ["2026-10-14T11:00", "2026-10-15T17:00"] }).slots).toHaveLength(2);
    expect(offerTimesInput.safeParse({ messageId: ID, slots: [] }).error?.issues[0].message).toMatch(/at least one/);
    expect(offerTimesInput.safeParse({ messageId: ID, slots: ["2026-10-14T11:00", "2026-10-14T11:00"] }).error?.issues[0].message).toMatch(/each time once/);
    expect(offerTimesInput.safeParse({ messageId: ID, slots: Array.from({ length: 13 }, (_, i) => `2026-10-${String(10 + i).padStart(2, "0")}T11:00`) }).success).toBe(false);
    expect(offerTimesInput.safeParse({ messageId: ID, slots: ["tomorrow at 11"] }).success).toBe(false);
    // Times only: a calendar, busy times or anything else is dropped.
    expect(Object.keys(offerTimesInput.parse({ messageId: ID, slots: ["2026-10-14T11:00"], calendar: "x", busy: [1] })).sort()).toEqual(["messageId", "slots"]);
  });

  it("book one offered slot with a round, a length and one to five interviewers", () => {
    const ok = scheduleInput.parse({ applicationId: ID, slotId: ID2, minutes: 45, interviewers: [ID] });
    expect(ok).toEqual({ applicationId: ID, slotId: ID2, round: "team", minutes: 45, interviewers: [ID] });
    expect(scheduleInput.safeParse({ applicationId: ID, slotId: ID2, minutes: 50, interviewers: [ID] }).success).toBe(false);
    expect(scheduleInput.safeParse({ applicationId: ID, slotId: ID2, minutes: 30, interviewers: [] }).error?.issues[0].message).toMatch(/at least one interviewer/);
    expect(scheduleInput.safeParse({ applicationId: ID, slotId: ID2, minutes: 30, interviewers: [ID, ID] }).success).toBe(false);
    expect(scheduleInput.safeParse({ applicationId: ID, slotId: ID2, minutes: 30, interviewers: [ID], round: "ai" }).success).toBe(false);
    expect(interviewIdInput.safeParse({ interviewId: "1" }).success).toBe(false);
  });

  it("read Indian mobile numbers as people type them", () => {
    for (const typed of ["9876543210", "+91 98765 43210", "+919876543210", "098765-43210", "91 9876543210", "(98765) 43210"]) expect(indianMobile.parse(typed)).toBe("+91 98765 43210");
    for (const bad of ["12345", "5876543210", "98765432101", "+1 415 555 0100", "call me", ""]) expect(indianMobile.safeParse(bad).success).toBe(false);
  });

  it("accept with or without a phone, or decline; a phone only when the person chooses to share it", () => {
    expect(respondInput.parse({ interviewId: ID, answer: "decline" })).toEqual({ interviewId: ID, answer: "decline" });
    expect(respondInput.parse({ interviewId: ID, answer: "accept", sharePhone: false, phone: "9876543210" })).toEqual({ interviewId: ID, answer: "accept", sharePhone: false });
    expect(respondInput.parse({ interviewId: ID, answer: "accept", sharePhone: true, phone: "98765 43210" })).toMatchObject({ phone: "+91 98765 43210" });
    expect(respondInput.safeParse({ interviewId: ID, answer: "accept", sharePhone: true }).success).toBe(false);
    expect(respondInput.safeParse({ interviewId: ID, answer: "accept", sharePhone: true, phone: "123" }).success).toBe(false);
    expect(respondInput.safeParse({ interviewId: ID, answer: "maybe" }).success).toBe(false);
  });

  it("take feedback in the interviewer's own words, 20 to 2,000 characters, with a recommendation", () => {
    expect(feedbackInput.parse({ interviewId: ID, recommendation: "yes", text: "  Clear on log triage; walked through two real alerts.  " }).text).toBe("Clear on log triage; walked through two real alerts.");
    expect(feedbackInput.safeParse({ interviewId: ID, recommendation: "yes", text: "Good." }).error?.issues[0].message).toMatch(/at least 20/);
    expect(feedbackInput.safeParse({ interviewId: ID, recommendation: "maybe", text: "x".repeat(30) }).success).toBe(false);
    expect(feedbackInput.safeParse({ interviewId: ID, recommendation: "no", text: "x".repeat(2001) }).success).toBe(false);
  });
});
