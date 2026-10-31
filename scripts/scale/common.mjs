// Shared by the scale check's seed, cleanup and timing scripts (docs/scale-check.md). Everything the seed writes is
// found again by the markers below, so scripts/scale/cleanup.mjs removes exactly those rows and nothing else.
import { createHmac } from "node:crypto";

/**
 * Members: scale-<n>@example.invalid as typed into the test sign-in, stored with the ".test" ending it adds
 * (src/lib/auth/test-user.ts). ".invalid" is a reserved domain, so no real address can match. No "_" or "%" in the
 * pattern, so LIKE matches only these.
 */
export const MEMBER_LIKE = "scale-%@example.invalid.test";
export const typedEmail = (n) => `scale-${String(n).padStart(5, "0")}@example.invalid`;
export const memberEmail = (n) => `${typedEmail(n)}.test`;
/** Feed posts on Departures: an ATS board token no real board uses. */
export const BOARD_PREFIX = "scale-board-";
export const BOARD_LIKE = `${BOARD_PREFIX}%`;
/** Timetable events (source "feed"): a source key no feed uses (real ones start "<feed id>:"). */
export const EVENT_PREFIX = "scale-event-";
export const EVENT_LIKE = `${EVENT_PREFIX}%`;
/** The one job feed run the seed adds, so Departures reads the seeded posts as live: a fixed id. */
export const FEED_RUN_ID = "5ca1e000-0000-4000-8000-000000000001";

/** The members time.mjs signs in as: spread through the seed so their data is typical, not the first rows written. */
export const TIMED_MEMBERS = [17, 2_503, 5_011, 7_777];

/**
 * Throws unless the database is on this machine (the CI job's own Postgres, or a local one). This PR never points the
 * scale check at staging or production; a later staging run adds its own guard.
 */
export function assertLocalDatabase(url) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("the scale check only runs against a local database");
  if (process.env.VERCEL_ENV === "production") throw new Error("the scale check never runs in production");
}

/** mulberry32: a small fixed-seed generator, so every run writes the same data. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** A version 4 UUID from the generator, so rows can point at each other before they are written. */
    uuid: () => {
      const h = Array.from({ length: 16 }, () => Math.floor(next() * 256));
      h[6] = (h[6] & 0x0f) | 0x40;
      h[8] = (h[8] & 0x3f) | 0x80;
      const s = h.map((b) => b.toString(16).padStart(2, "0")).join("");
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
  };
}

/**
 * The test sign-in's cookie for a member, signed as src/lib/auth/test-user.ts signs it (HMAC with CRON_SECRET). It only
 * works where that sign-in is on: a preview or local build with no Supabase keys, never production.
 */
export const TEST_USER_COOKIE = "cm_test_user";
export function testUserCookie(email, name, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), n: name, x: now + 86_400_000 })).toString("base64url");
  const mac = createHmac("sha256", `test-user|${secret || "local-development-only"}`).update(body).digest("base64url");
  return `${body}.${mac}`;
}
