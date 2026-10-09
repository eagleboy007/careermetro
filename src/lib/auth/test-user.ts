import { createHmac, timingSafeEqual } from "node:crypto";
import type { Identity } from "@/lib/account/store";
import { authConfig } from "./config";

/*
 * A stand-in sign-in for preview links while the real one waits on its keys: type a name and email, no check.
 * It switches itself off once Supabase is set up, and never runs in production, whatever the preview flag says.
 */

export const TEST_USER_COOKIE = "cm_test_user";
const MAX_AGE_DAYS = 30;

/** True on local and preview deployments until the real sign-in has its keys. Never in production. */
export function testSignInEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production" && !authConfig(env);
}

function key(env: Record<string, string | undefined>): string {
  return `test-user|${env.CRON_SECRET || "local-development-only"}`;
}

const sign = (body: string, env: Record<string, string | undefined>) => createHmac("sha256", key(env)).update(body).digest("base64url");

/** The cookie value for a test user: their email and name, signed so it can't be edited into someone else. */
export function testUserCookie(user: { email: string; name: string | null }, env: Record<string, string | undefined> = process.env, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ e: user.email.trim().toLowerCase(), n: user.name, x: now + MAX_AGE_DAYS * 86_400_000 })).toString("base64url");
  return `${body}.${sign(body, env)}`;
}

/**
 * The test user in a cookie value, or null when the value is missing, edited, expired or test sign-in is off.
 * The subject starts with "test:", the email counts as unproven and gets the reserved ".test" ending, so a test user
 * never takes over, or blocks, a real account with the same address.
 */
export function testUserIdentity(value: string | undefined, env: Record<string, string | undefined> = process.env, now = Date.now()): Identity | null {
  if (!value || !testSignInEnabled(env)) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, env));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { e?: unknown; n?: unknown; x?: unknown };
    if (typeof data.e !== "string" || typeof data.x !== "number" || data.x < now) return null;
    const email = data.e.endsWith(".test") ? data.e : `${data.e}.test`;
    return { subject: `test:${email}`, email, emailVerified: false, name: typeof data.n === "string" ? data.n : null };
  } catch {
    return null;
  }
}

export const TEST_USER_MAX_AGE_SECONDS = MAX_AGE_DAYS * 86_400;
