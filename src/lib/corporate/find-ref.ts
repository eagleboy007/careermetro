import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { findRefSecret } from "@/lib/hash-keys";

/*
 * The opaque ref a company sees for each person in its search results (pending item 19, dev/companies-find-me-plan.md):
 * the person's id sealed with AES-256-GCM, the company's id as associated data, and an IV derived from both (the SIV
 * construction), so the same person reads as the same ref to one company, a different ref to every other company, and
 * a ref from one company opens nothing for another. Internal user ids never reach a company's browser. Without a key
 * (production with none set) nothing is sealed or opened, and search is off.
 */

type Env = Record<string, string | undefined>;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ID_BYTES = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (env: Env): Buffer | null => {
  const secret = findRefSecret(env);
  return secret === null ? null : createHash("sha256").update(secret).digest();
};

const ivFor = (key: Buffer, orgId: string, userId: string) => createHmac("sha256", key).update(`iv|${orgId.toLowerCase()}|${userId.toLowerCase()}`).digest().subarray(0, IV_BYTES);

/** Whether refs can be made now: false only when production has no key. */
export const findRefsAvailable = (env: Env = process.env): boolean => findRefSecret(env) !== null;

/** The person's ref for this company: 59 base64url characters, or null without a key or for a malformed id. */
export function sealRef(userId: string, orgId: string, env: Env = process.env): string | null {
  const key = keyOf(env);
  if (!key || !UUID.test(userId) || !UUID.test(orgId)) return null;
  const iv = ivFor(key, orgId, userId);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(orgId.toLowerCase(), "utf8"));
  const body = Buffer.concat([cipher.update(Buffer.from(userId.replace(/-/g, ""), "hex")), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The person's id back, or null when the ref is altered, made for another company or with another key. */
export function openRef(ref: string, orgId: string, env: Env = process.env): string | null {
  const key = keyOf(env);
  if (!key || !UUID.test(orgId) || !/^[A-Za-z0-9_-]+$/.test(ref)) return null;
  const raw = Buffer.from(ref, "base64url");
  if (raw.length !== IV_BYTES + TAG_BYTES + ID_BYTES) return null;
  const iv = raw.subarray(0, IV_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(orgId.toLowerCase(), "utf8"));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const hex = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    // The IV must be the one this company and person give, so only refs this code made open.
    return timingSafeEqual(iv, ivFor(key, orgId, id)) ? id : null;
  } catch {
    return null;
  }
}
