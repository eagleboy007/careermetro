import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/proxy-session", () => ({ refreshSession: refresh }));

import { NextResponse } from "next/server";
import { TEST_USER_COOKIE, testUserCookie } from "@/lib/auth/test-user";
import { config, proxy } from "./proxy";

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
    for (const p of ["/today", "/map", "/departures", "/me", "/sign-in", "/sign-up/finish", "/auth/callback"]) expect((await proxy(req(p))).status).toBe(404);
    expect((await proxy(req("/start"))).headers.get("x-middleware-next")).toBe("1");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses the test user on previews while sign-in is not set up", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    refresh.mockResolvedValue({ response: NextResponse.next(), signedIn: false });
    expect((await proxy(req("/today"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Ftoday");
    expect((await proxy(req("/map"))).headers.get("location")).toBe("https://careermetro.test/sign-in?next=%2Fmap");
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

  it("skips static files", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/today")).toBe(true);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/logo.svg")).toBe(false);
    expect(re.test("/api/resume")).toBe(false);
  });
});
