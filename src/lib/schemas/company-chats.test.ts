import { describe, expect, it } from "vitest";
import { companyMessageInput, SYSTEM_CODES } from "@/lib/schemas";

const APP = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";

describe("company chat schemas (corporate build step 5)", () => {
  it("take a message for one application, trimmed, as a plain message unless it is a question", () => {
    expect(companyMessageInput.parse({ applicationId: APP, body: "  Thanks for applying.  " })).toEqual({ applicationId: APP, body: "Thanks for applying.", question: false });
    expect(companyMessageInput.parse({ applicationId: APP, body: "Which SIEM have you used?", question: true }).question).toBe(true);
  });

  it("refuse an empty or overlong message, or a missing application", () => {
    expect(companyMessageInput.safeParse({ applicationId: APP, body: "   " }).error?.issues[0].message).toMatch(/Write a message/);
    expect(companyMessageInput.safeParse({ applicationId: APP, body: "x".repeat(2001) }).success).toBe(false);
    expect(companyMessageInput.parse({ applicationId: APP, body: "x".repeat(2000) }).body).toHaveLength(2000);
    expect(companyMessageInput.safeParse({ applicationId: "1", body: "Hello" }).success).toBe(false);
    expect(companyMessageInput.safeParse({ body: "Hello" }).success).toBe(false);
  });

  it("drop anything else a caller sends, so no other message kind or sender can come in", () => {
    const parsed = companyMessageInput.parse({ applicationId: APP, body: "Hello", kind: "system", senderId: APP, conversationId: APP });
    expect(Object.keys(parsed).sort()).toEqual(["applicationId", "body", "question"]);
  });

  it("know the system line that opens an application chat", () => {
    expect(SYSTEM_CODES).toContain("applied");
  });
});
