import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieJar } from "@/test/cookie-jar";

const jar = vi.hoisted(() => ({ current: null as ReturnType<typeof cookieJar> | null }));
const account = vi.hoisted(() => ({ current: null as { id: string } | null }));
vi.mock("next/headers", () => ({ cookies: async () => jar.current, headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => account.current }));

import { clientHash, clientIp, ensureOwner, ensureSessionId, isSameOrigin, readOwner, readSessionId, SESSION_COOKIE } from "./session";

const VALID = "A".repeat(43);

describe("anonymous session cookie", () => {
  afterEach(() => {
    jar.current = null;
    account.current = null;
    vi.unstubAllEnvs();
  });

  it("accepts only a 43-character base64url id", async () => {
    jar.current = cookieJar();
    for (const bad of ["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}.`, `${"A".repeat(42)}'`]) {
      jar.current.set(SESSION_COOKIE, bad);
      expect(await readSessionId()).toBeNull();
    }
    jar.current.set(SESSION_COOKIE, VALID);
    expect(await readSessionId()).toBe(VALID);
  });

  it("creates a random, http-only, same-site cookie that lasts as long as the anonymous data", async () => {
    vi.stubEnv("NODE_ENV", "production");
    jar.current = cookieJar();
    const id = await ensureSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jar.current.options.get(SESSION_COOKIE)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 24 * 3600 });
    expect(await ensureSessionId()).toBe(id);
    jar.current.clear();
    expect(await ensureSessionId()).not.toBe(id);
  });

  it("replaces a malformed cookie instead of trusting it", async () => {
    jar.current = cookieJar();
    jar.current.set(SESSION_COOKIE, "../../etc/passwd");
    const id = await ensureSessionId();
    expect(id).not.toBe("../../etc/passwd");
    expect(jar.current.values.get(SESSION_COOKIE)).toBe(id);
  });
});

describe("owner", () => {
  afterEach(() => {
    jar.current = null;
    account.current = null;
  });

  it("is the signed-in account even when an anonymous cookie is present", async () => {
    jar.current = cookieJar();
    jar.current.set(SESSION_COOKIE, VALID);
    account.current = { id: "user-1" };
    expect(await readOwner()).toEqual({ userId: "user-1" });
    expect(await ensureOwner()).toEqual({ userId: "user-1" });
  });

  it("is the anonymous session otherwise, and nobody without a cookie", async () => {
    jar.current = cookieJar();
    expect(await readOwner()).toBeNull();
    jar.current.set(SESSION_COOKIE, VALID);
    expect(await readOwner()).toEqual({ sessionId: VALID });
  });

  it("ensureOwner gives a visitor without a cookie a new session, never an account", async () => {
    jar.current = cookieJar();
    const owner = await ensureOwner();
    expect(owner.userId).toBeUndefined();
    expect(owner.sessionId).toBe(jar.current.values.get(SESSION_COOKIE));
  });
});

describe("isSameOrigin", () => {
  const req = (origin: string | null, url = "https://careermetro.vercel.app/api/x") =>
    new Request(url, { method: "POST", headers: origin === null ? {} : { origin } });

  it("needs an Origin header for this host", () => {
    expect(isSameOrigin(req("https://careermetro.vercel.app"))).toBe(true);
    expect(isSameOrigin(req(null))).toBe(false);
    expect(isSameOrigin(req("null"))).toBe(false);
    expect(isSameOrigin(req("https://evil.example"))).toBe(false);
    expect(isSameOrigin(req("https://careermetro.vercel.app.evil.example"))).toBe(false);
    expect(isSameOrigin(req("https://evil.careermetro.vercel.app"))).toBe(false);
    expect(isSameOrigin(req("https://careermetro.vercel.app:8443"))).toBe(false);
    expect(isSameOrigin(req("not a url"))).toBe(false);
  });
});

describe("client hash", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never contains the IP, changes each UTC day, and depends on the secret", () => {
    vi.stubEnv("CRON_SECRET", "secret-a");
    const day = new Date("2026-10-11T10:00:00Z");
    const a = clientHash("203.0.113.7", day);
    expect(a).not.toContain("203");
    expect(clientHash("203.0.113.7", new Date("2026-10-11T23:59:00Z"))).toBe(a);
    expect(clientHash("203.0.113.7", new Date("2026-10-12T00:00:00Z"))).not.toBe(a);
    expect(clientHash("203.0.113.8", day)).not.toBe(a);
    vi.stubEnv("CRON_SECRET", "secret-b");
    expect(clientHash("203.0.113.7", day)).not.toBe(a);
  });

  it("takes the first forwarded address", () => {
    const r = (h: Record<string, string>) => new Request("https://x.test/", { headers: h });
    expect(clientIp(r({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(r({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(r({}))).toBe("local");
  });
});
