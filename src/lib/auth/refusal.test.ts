import { describe, expect, it } from "vitest";
import { logLine } from "@/lib/log";
import { refusalFields } from "./refusal";

describe("sign-in refusal log fields", () => {
  it("keeps the provider's code and status only", () => {
    const error = Object.assign(new Error("Token has expired for priya@example.com"), { code: "otp_expired", status: 403 });
    expect(refusalFields(error)).toEqual({ code: "otp_expired", status: 403 });
    const line = logLine("warn", "auth_email_code_verify_refused", refusalFields(error));
    expect(line).not.toContain("priya");
    expect(line).not.toContain("expired for");
  });

  it("writes unknown for a missing or odd code and leaves out a non-number status", () => {
    expect(refusalFields(new Error("x"))).toEqual({ code: "unknown" });
    expect(refusalFields({ code: "Has spaces and priya@example.com", status: "403" })).toEqual({ code: "unknown" });
    expect(refusalFields(null)).toEqual({ code: "unknown" });
  });
});
