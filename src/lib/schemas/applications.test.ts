import { describe, expect, it } from "vitest";
import { applicationIdInput, applyInput, moveInput } from "@/lib/schemas";

const JOB = "1c9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a70";
const APP = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";

describe("application schemas (corporate build step 4)", () => {
  it("take an application only with the consent ticked and a Can join answer", () => {
    expect(applyInput.parse({ jobId: JOB, canJoin: "30", consent: true })).toEqual({ jobId: JOB, canJoin: "30", consent: true });
    expect(applyInput.safeParse({ jobId: JOB, canJoin: "30", consent: false }).error?.issues[0].message).toMatch(/Tick the box/);
    expect(applyInput.safeParse({ jobId: JOB, canJoin: "30" }).success).toBe(false);
    expect(applyInput.safeParse({ jobId: JOB, canJoin: "120", consent: true }).error?.issues[0].message).toMatch(/when you can join/);
    expect(applyInput.safeParse({ jobId: "x", canJoin: "now", consent: true }).success).toBe(false);
  });

  it("never take a notice period, pay or phone on applying", () => {
    const parsed = applyInput.parse({ jobId: JOB, canJoin: "now", consent: true, noticeDays: 90, pay: "12 LPA", phone: "9800000000" });
    expect(parsed).not.toHaveProperty("noticeDays");
    expect(parsed).not.toHaveProperty("pay");
    expect(parsed).not.toHaveProperty("phone");
  });

  it("move to a lane, with a note required for Not this time", () => {
    expect(moveInput.parse({ applicationId: APP, to: "shortlisted" })).toEqual({ applicationId: APP, to: "shortlisted", note: "" });
    const refused = moveInput.safeParse({ applicationId: APP, to: "not_this_time", note: "  " });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0].message).toMatch(/note/);
    expect(moveInput.safeParse({ applicationId: APP, to: "not_this_time", note: "short" }).success).toBe(false);
    const ok = moveInput.parse({ applicationId: APP, to: "not_this_time", note: "  We need hands-on SIEM for this role.  " });
    expect(ok.note).toBe("We need hands-on SIEM for this role.");
    expect(moveInput.safeParse({ applicationId: APP, to: "not_this_time", note: "x".repeat(501) }).success).toBe(false);
    expect(moveInput.safeParse({ applicationId: APP, to: "hired" }).success).toBe(false);
  });

  it("take an application id", () => {
    expect(applicationIdInput.safeParse({ applicationId: APP }).success).toBe(true);
    expect(applicationIdInput.safeParse({ applicationId: "1" }).success).toBe(false);
  });
});
