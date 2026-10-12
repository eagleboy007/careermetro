import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { workEmailHashKey } from "@/lib/hash-keys";

/*
 * The 6-digit work-email code (handoff 12d and 12f): 10 minutes, 5 wrong tries, then a 15-minute wait. The code is
 * only ever stored and compared as a keyed hash. Pure apart from the random code, so the rules are tested directly.
 */

type Env = Record<string, string | undefined>;

export const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60_000;
export const MAX_WRONG_TRIES = 5;
export const LOCK_MS = 15 * 60_000;

/** A fresh code: 6 digits, leading zeros kept, from the system's secure random source. */
export const newCode = (): string => String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");

/** True for exactly six digits. Spaces people type between groups are removed first by the schema. */
export const isCodeShape = (code: string): boolean => /^\d{6}$/.test(code);

/** The stored hash of a code, bound to the person and the code row, so a hash can't be replayed for anyone else. */
export function hashCode(rowId: string, userId: string, code: string, env: Env = process.env): string {
  return createHmac("sha256", workEmailHashKey(env)).update(`code|${rowId}|${userId}|${code}`).digest("base64url");
}

/** Compares a typed code with the stored hash in constant time (both are fixed-length digests). */
export function codeMatches(stored: string | null, rowId: string, userId: string, typed: string, env: Env = process.env): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(hashCode(rowId, userId, isCodeShape(typed) ? typed : "x", env));
  return a.length === b.length && timingSafeEqual(a, b) && isCodeShape(typed);
}

/**
 * The keyed hash of a work email, for an invite: the address itself is never stored. Lowercased first, so the
 * colleague can type it in any case.
 */
export function hashWorkEmail(email: string, env: Env = process.env): string {
  return createHmac("sha256", workEmailHashKey(env)).update(`invite|${email.trim().toLowerCase()}`).digest("base64url");
}

export type CodeRow = { expiresAt: Date; attempts: number; lockedUntil: Date | null; usedAt: Date | null; codeHash: string | null };

export type CodeState = "open" | "used" | "expired" | "locked";

/** Where a code stands at `now`. A lock outlasts the code itself: after 5 wrong tries the person waits 15 minutes. */
export function codeState(row: CodeRow, now: Date): CodeState {
  if (row.lockedUntil && row.lockedUntil > now) return "locked";
  if (row.usedAt) return "used";
  if (!row.codeHash || row.attempts >= MAX_WRONG_TRIES || row.expiresAt <= now) return "expired";
  return "open";
}

/** What a wrong try does to the row: one more attempt, and on the fifth a lock and the code is spent. */
export function afterWrongTry(row: Pick<CodeRow, "attempts">, now: Date): { attempts: number; lockedUntil: Date | null; spent: boolean } {
  const attempts = row.attempts + 1;
  return attempts >= MAX_WRONG_TRIES ? { attempts, lockedUntil: new Date(now.getTime() + LOCK_MS), spent: true } : { attempts, lockedUntil: null, spent: false };
}

/** Words for each refusal of a code. */
export const CODE_ERROR_TEXT = {
  wrong: "That code isn't right. Check the latest email and try again.",
  expired: "That code has expired. Send a new one.",
  locked: "Too many wrong tries. Wait 15 minutes, then send a new code.",
  none: "Send a code first.",
} as const;
