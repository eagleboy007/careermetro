import { describe, expect, it } from "vitest";
import { adminEmails, isAdmin, LOCAL_ADMIN_EMAIL } from "./access";

// Who may open /admin/companies: a proven sign-in whose email is in ADMIN_EMAILS; the test user's local default only
// in test mode; nobody in production while ADMIN_EMAILS is unset.
const google = (email: string) => ({ email, emailVerified: true, method: "google" as const });
const test = (email: string) => ({ email, emailVerified: false, method: "test" as const });
const prod = { VERCEL_ENV: "production", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" };
const local = { NODE_ENV: "development" };
const preview = { VERCEL_ENV: "preview", NODE_ENV: "production" };

describe("admin access", () => {
  it("reads ADMIN_EMAILS as a trimmed, lowercase list", () => {
    expect(adminEmails({ ADMIN_EMAILS: " Reviewer@Example.com , ,other@example.org," })).toEqual(["reviewer@example.com", "other@example.org"]);
    expect(adminEmails({})).toEqual([]);
    expect(adminEmails({ ADMIN_EMAILS: "not-an-email" })).toEqual([]);
  });

  it("lets in a proven sign-in whose email is listed, in any case, and nobody else", () => {
    const env = { ...prod, ADMIN_EMAILS: "reviewer@example.com" };
    expect(isAdmin(google("Reviewer@Example.com"), env)).toBe(true);
    expect(isAdmin({ email: "reviewer@example.com", emailVerified: true, method: "email_code" }, env)).toBe(true);
    expect(isAdmin(google("someone@example.com"), env)).toBe(false);
    // An email the sign-in didn't prove (a password sign-in) never counts.
    expect(isAdmin({ email: "reviewer@example.com", emailVerified: false }, env)).toBe(false);
    expect(isAdmin(null, env)).toBe(false);
  });

  it("lets nobody in, in production, while ADMIN_EMAILS is unset", () => {
    expect(isAdmin(google("reviewer@example.com"), prod)).toBe(false);
    expect(isAdmin(test(LOCAL_ADMIN_EMAIL), prod)).toBe(false);
    expect(isAdmin(test(LOCAL_ADMIN_EMAIL), { VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(isAdmin(google(LOCAL_ADMIN_EMAIL), prod)).toBe(false);
  });

  it("uses the documented local admin only for the test sign-in, locally or on a preview, while ADMIN_EMAILS is unset", () => {
    expect(isAdmin(test(LOCAL_ADMIN_EMAIL), local)).toBe(true);
    expect(isAdmin(test(LOCAL_ADMIN_EMAIL), preview)).toBe(true);
    expect(isAdmin(test("someone@careermetro.test"), local)).toBe(false);
    // Once ADMIN_EMAILS is set the default is off, and a test user's ".test" email can't match a real address.
    expect(isAdmin(test(LOCAL_ADMIN_EMAIL), { ...local, ADMIN_EMAILS: "reviewer@example.com" })).toBe(false);
    expect(isAdmin(test("reviewer@example.com.test"), { ...local, ADMIN_EMAILS: "reviewer@example.com" })).toBe(false);
    // With the real sign-in set up, the test sign-in is off, and so is the default.
    expect(isAdmin(test(LOCAL_ADMIN_EMAIL), { ...local, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBe(false);
    expect(isAdmin(google(LOCAL_ADMIN_EMAIL), local)).toBe(false);
  });
});
