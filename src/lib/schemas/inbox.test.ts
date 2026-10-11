import { describe, expect, it } from "vitest";
import { MESSAGE_MAX_CHARS, messageBody, reportDeadlines, reportInput, sendMessageInput } from "./inbox";

const id = "6f1d3c1e-2b4a-4c8e-9f00-1a2b3c4d5e6f";

describe("inbox schemas", () => {
  it("trims a message and keeps it within the limit", () => {
    expect(messageBody.parse("  hello  ")).toBe("hello");
    expect(messageBody.safeParse("   ").success).toBe(false);
    expect(messageBody.safeParse("a".repeat(MESSAGE_MAX_CHARS)).success).toBe(true);
    expect(messageBody.safeParse("a".repeat(MESSAGE_MAX_CHARS + 1)).success).toBe(false);
    expect(sendMessageInput.safeParse({ conversationId: "not-an-id", body: "hi" }).success).toBe(false);
  });

  it("needs the message for a message report, and only then", () => {
    expect(reportInput.safeParse({ conversationId: id, target: "message", reason: "harassment" }).success).toBe(false);
    expect(reportInput.safeParse({ conversationId: id, target: "message", messageId: id, reason: "harassment" }).success).toBe(true);
    expect(reportInput.safeParse({ conversationId: id, target: "person", messageId: id, reason: "harassment" }).success).toBe(false);
    expect(reportInput.parse({ conversationId: id, target: "person", reason: "other" }).block).toBe(false);
    expect(reportInput.safeParse({ conversationId: id, target: "chat", reason: "made_up" }).success).toBe(false);
    expect(reportInput.safeParse({ conversationId: id, target: "chat", reason: "other", note: "x".repeat(501) }).success).toBe(false);
  });

  it("sets the IT Rules deadlines by reason", () => {
    const at = new Date("2026-10-11T10:00:00Z");
    const hours = (d: Date) => (d.getTime() - at.getTime()) / 3_600_000;
    for (const reason of ["money_or_otp", "harassment", "intimate_or_impersonation", "fake_or_spam", "other"] as const)
      expect(hours(reportDeadlines(reason, at).acknowledgeBy)).toBe(24);
    expect(hours(reportDeadlines("intimate_or_impersonation", at).resolveBy)).toBe(24);
    expect(hours(reportDeadlines("harassment", at).resolveBy)).toBe(72);
    expect(hours(reportDeadlines("money_or_otp", at).resolveBy)).toBe(72);
    expect(hours(reportDeadlines("other", at).resolveBy)).toBe(15 * 24);
  });
});
