import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/** Cookie for the anonymous first analysis (FR-2). It lives as long as the data it points to. */
export const SESSION_COOKIE = "cm_session";
export const ANONYMOUS_TTL_HOURS = 24;

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;

/** The visitor's anonymous session id, or null when they have none or it is malformed. */
export async function readSessionId(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && SESSION_ID.test(value) ? value : null;
}

/** Returns the visitor's session id, creating and setting one if needed. Call only from a route handler or server action. */
export async function ensureSessionId(): Promise<string> {
  const existing = await readSessionId();
  if (existing) return existing;
  const id = randomBytes(32).toString("base64url");
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ANONYMOUS_TTL_HOURS * 60 * 60,
  });
  return id;
}

/**
 * A keyed hash of the client IP and the UTC day, used only to count uploads per day (SEC-7).
 * The key is CRON_SECRET, so the hash can't be reversed without it, and the day makes hashes unlinkable across days.
 */
export function clientHash(ip: string, now = new Date()): string {
  const key = process.env.CRON_SECRET || "local-development-only";
  return createHmac("sha256", key).update(`${ip}|${now.toISOString().slice(0, 10)}`).digest("base64url");
}

/** The caller's IP as Vercel reports it. Falls back to a fixed value locally. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

/** CSRF protection for form posts (SEC-7): the request must come from a page on this site. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
