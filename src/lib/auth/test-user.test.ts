import { describe, expect, it } from "vitest";
import { testSignInEnabled, testUserCookie, testUserIdentity } from "./test-user";

const preview = { VERCEL_ENV: "preview", CRON_SECRET: "s" };

describe("test sign-in", () => {
  it("is on for local and preview until the real sign-in has keys, and never in production", () => {
    expect(testSignInEnabled({})).toBe(true);
    expect(testSignInEnabled(preview)).toBe(true);
    expect(testSignInEnabled({ VERCEL_ENV: "production", TODAY_PREVIEW: "1" })).toBe(false);
    expect(testSignInEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(testSignInEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    expect(testSignInEnabled({ ...preview, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBe(false);
  });

  it("reads back a signed cookie as an unproven test identity", () => {
    const value = testUserCookie({ email: " Asha@Example.com ", name: "Asha" }, preview);
    expect(testUserIdentity(value, preview)).toEqual({ subject: "test:asha@example.com.test", email: "asha@example.com.test", emailVerified: false, name: "Asha" });
  });

  it("refuses an edited, foreign, expired or switched-off cookie", () => {
    const value = testUserCookie({ email: "a@b.in", name: null }, preview, 0);
    const [body, mac] = value.split(".");
    const other = Buffer.from(JSON.stringify({ e: "boss@b.in", n: null, x: Date.now() + 1e9 })).toString("base64url");
    expect(testUserIdentity(`${other}.${mac}`, preview)).toBeNull();
    expect(testUserIdentity(testUserCookie({ email: "a@b.in", name: null }, { CRON_SECRET: "other" }), preview)).toBeNull();
    expect(testUserIdentity(`${body}.${mac}`, preview)).toBeNull();
    const fresh = testUserCookie({ email: "a@b.in", name: null }, preview);
    expect(testUserIdentity(fresh, { ...preview, VERCEL_ENV: "production" })).toBeNull();
    expect(testUserIdentity("junk", preview)).toBeNull();
  });
});
