import { describe, expect, it } from "vitest";
import { identityFromClaims } from "./claims";

const base = { sub: "u1", email: "a@b.in" };

describe("identityFromClaims", () => {
  it("keeps the subject, email and a trimmed name", () => {
    expect(identityFromClaims({ ...base, amr: [{ method: "oauth", timestamp: 1 }], user_metadata: { full_name: "  Asha Rao " } })).toEqual({
      subject: "u1",
      email: "a@b.in",
      emailVerified: true,
      name: "Asha Rao",
    });
    expect(identityFromClaims({ ...base, user_metadata: { name: "Asha" } })).toMatchObject({ name: "Asha" });
    expect(identityFromClaims(base)).toMatchObject({ name: null });
  });

  it("trusts only the signed sign-in method for a verified email, never user_metadata", () => {
    expect(identityFromClaims({ ...base, amr: [{ method: "otp", timestamp: 1 }] })).toMatchObject({ emailVerified: true });
    expect(identityFromClaims({ ...base, amr: ["oauth"] })).toMatchObject({ emailVerified: true });
    expect(identityFromClaims({ ...base, amr: [{ method: "password", timestamp: 1 }], user_metadata: { email_verified: true } })).toMatchObject({
      emailVerified: false,
    });
    expect(identityFromClaims({ ...base, user_metadata: { email_verified: true } })).toMatchObject({ emailVerified: false });
  });

  it("refuses claims without a subject or an email", () => {
    expect(identityFromClaims(null)).toBeNull();
    expect(identityFromClaims({ sub: "u1" })).toBeNull();
    expect(identityFromClaims({ email: "a@b.in" })).toBeNull();
  });
});
