import { describe, expect, it } from "vitest";
import { authConfig, hasAuthCookie, safeNext } from "./config";

describe("auth config", () => {
  it("is off until both public settings exist", () => {
    expect(authConfig({})).toBeNull();
    expect(authConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
    expect(authConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toEqual({
      url: "https://x.supabase.co",
      anonKey: "k",
    });
  });

  it("refuses a plain-http or broken URL except on this machine", () => {
    expect(authConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeNull();
    expect(authConfig({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeNull();
    expect(authConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).not.toBeNull();
  });

  it("spots the session cookie, including chunked ones", () => {
    expect(hasAuthCookie(["cm_session"])).toBe(false);
    expect(hasAuthCookie(["sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
  });
});

describe("safeNext", () => {
  it("keeps paths on this site and drops everything else", () => {
    expect(safeNext("/resume/1?x=2")).toBe("/resume/1?x=2");
    expect(safeNext(null)).toBe("/today");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "today", "/a\nb"]) expect(safeNext(bad)).toBe("/today");
  });
});
