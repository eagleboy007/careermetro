import { describe, expect, it } from "vitest";
import { identityFromClaims } from "./claims";

describe("identityFromClaims", () => {
  it("keeps the subject, email, verified flag and a trimmed name", () => {
    expect(
      identityFromClaims({ sub: "u1", email: "a@b.in", user_metadata: { full_name: "  Asha Rao ", email_verified: true } }),
    ).toEqual({ subject: "u1", email: "a@b.in", emailVerified: true, name: "Asha Rao" });
  });

  it("treats a missing verified flag as unverified and falls back to name", () => {
    expect(identityFromClaims({ sub: "u1", email: "a@b.in", user_metadata: { name: "Asha" } })).toMatchObject({ emailVerified: false, name: "Asha" });
    expect(identityFromClaims({ sub: "u1", email: "a@b.in" })).toMatchObject({ name: null });
  });

  it("refuses claims without a subject or an email", () => {
    expect(identityFromClaims(null)).toBeNull();
    expect(identityFromClaims({ sub: "u1" })).toBeNull();
    expect(identityFromClaims({ email: "a@b.in" })).toBeNull();
  });
});
