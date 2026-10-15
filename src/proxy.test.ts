import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/proxy-session", () => ({ refreshSession: refresh }));

import { NextResponse } from "next/server";
import { TEST_USER_COOKIE, testUserCookie } from "@/lib/auth/test-user";
import { LOCAL_ADMIN_EMAIL } from "@/lib/admin/access";
import { config, NOT_FOUND_PATH, proxy } from "./proxy";

const req = (path: string, cookie?: string) => {
  const r = new NextRequest(new URL(path, "https://careermetro.test"));
  if (cookie) r.cookies.set(TEST_USER_COOKIE, cookie);
  return r;
};

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    refresh.mockReset();
  });

  it("answers 404 for signed-in screens in production without the preview flag, and refreshes no session", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TODAY_PREVIEW", "");
    for (const p of ["/today", "/map", "/match", "/practice", "/market", "/departures", "/arrivals", "/inbox", "/corporate", "/corporate/jobs/board", "/grievances", "/privacy", "/terms", "/me", "/settings", "/u/priya-n", "/account/restore", "/account/deleted", "/sign-in", "/sign-up/finish", "/auth/callback"]) expect((await proxy(req(p))).status).toBe(404);
    expect((await proxy(req("/start"))).headers.get("x-middleware-next")).toBe("1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses the test user on previews while sign-in is not set up", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    refresh.mockResolvedValue({ response: NextResponse.next(), signedIn: false });
    expect((await proxy(req("/today"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Ftoday");
    expect((await proxy(req("/map"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fmap");
    expect((await proxy(req("/match"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fmatch");
    expect((await proxy(req("/practice"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fpractice");
    expect((await proxy(req("/settings"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fsettings");
    expect((await proxy(req("/corporate/messages"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fcorporate%2Fmessages");
    expect((await proxy(req("/u/priya-n"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fu%2Fpriya-n");
    expect((await proxy(req("/upload"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/account/restore"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Faccount%2Frestore");
    expect((await proxy(req("/account/suspended"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Faccount%2Fsuspended");
    // Where a deleted account lands, signed out.
    expect((await proxy(req("/account/deleted"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/today", "forged.value"))).headers.get("location")).toContain("/sign-in");
    const cookie = testUserCookie({ email: "asha@example.com", name: "Asha" });
    expect((await proxy(req("/today", cookie))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/", cookie))).headers.get("location")).toBe("https://careermetro.test/today");
  });

  it("shows example data, with no sign-in, in production behind the preview flag", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TODAY_PREVIEW", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    refresh.mockResolvedValue({ response: NextResponse.next(), signedIn: false });
    expect((await proxy(req("/today"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("sends signed-out visitors to sign-in and signed-in visitors from home to Today", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    refresh.mockResolvedValue({ response: NextResponse.next(), signedIn: false });
    const out = await proxy(req("/today?state=first"));
    expect(out.headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Ftoday%3Fstate%3Dfirst");
    expect((await proxy(req("/"))).headers.get("x-middleware-next")).toBe("1");

    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-x-auth-token", "new");
    refresh.mockResolvedValue({ response: refreshed, signedIn: true });
    const home = await proxy(req("/"));
    expect(home.headers.get("location")).toBe("https://careermetro.test/today");
    expect(home.cookies.get("sb-x-auth-token")?.value).toBe("new");
    expect((await proxy(req("/today"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/sign-in"))).headers.get("location")).toBe("https://careermetro.test/today");
  });

  it("answers the admin pages with the normal not-found page for anyone but an admin, signed out included", async () => {
    const rewrittenTo = (r: Response) => r.headers.get("x-middleware-rewrite");
    const notFound = `https://careermetro.test${NOT_FOUND_PATH}`;
    // Production without the preview flag: no auth work, not found.
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TODAY_PREVIEW", "");
    expect(rewrittenTo(await proxy(req("/admin/companies")))).toBe(notFound);
    expect(refresh).not.toHaveBeenCalled();

    // A preview with the test sign-in: signed out, a test user who isn't the admin, and the documented local admin.
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    refresh.mockResolvedValue({ response: NextResponse.next(), signedIn: false, identity: null });
    expect(rewrittenTo(await proxy(req("/admin/companies")))).toBe(notFound);
    expect(rewrittenTo(await proxy(req("/admin")))).toBe(notFound);
    // The held-proof review sits behind the same gate.
    expect(rewrittenTo(await proxy(req("/admin/proofs")))).toBe(notFound);
    expect(rewrittenTo(await proxy(req("/admin/proofs", testUserCookie({ email: "asha@example.com", name: "Asha" }))))).toBe(notFound);
    expect(rewrittenTo(await proxy(req("/admin/proofs", testUserCookie({ email: LOCAL_ADMIN_EMAIL, name: "Admin" }))))).toBeNull();
    expect(rewrittenTo(await proxy(req("/admin/companies", testUserCookie({ email: "asha@example.com", name: "Asha" }))))).toBe(notFound);
    const admin = await proxy(req("/admin/companies", testUserCookie({ email: LOCAL_ADMIN_EMAIL, name: "Admin" })));
    expect(rewrittenTo(admin)).toBeNull();
    expect(admin.headers.get("x-middleware-next")).toBe("1");
    // Once ADMIN_EMAILS is set, the local default is off.
    vi.stubEnv("ADMIN_EMAILS", "reviewer@example.com");
    expect(rewrittenTo(await proxy(req("/admin/companies", testUserCookie({ email: LOCAL_ADMIN_EMAIL, name: "Admin" }))))).toBe(notFound);

    // The real sign-in: only a proven email in ADMIN_EMAILS, and refreshed cookies are kept either way.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    const refreshed = NextResponse.next();
    refreshed.cookies.set("sb-x-auth-token", "new");
    refresh.mockResolvedValue({ response: refreshed, signedIn: true, identity: { subject: "s1", email: "someone@example.com", emailVerified: true, name: null, method: "google" } });
    const other = await proxy(req("/admin/companies"));
    expect(rewrittenTo(other)).toBe(notFound);
    expect(other.cookies.get("sb-x-auth-token")?.value).toBe("new");
    refresh.mockResolvedValue({ response: refreshed, signedIn: true, identity: { subject: "s2", email: "Reviewer@Example.com", emailVerified: true, name: null, method: "google" } });
    expect(rewrittenTo(await proxy(req("/admin/companies")))).toBeNull();
  });

  it("skips static files", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/today")).toBe(true);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/logo.svg")).toBe(false);
    expect(re.test("/api/resume")).toBe(false);
  });
});
