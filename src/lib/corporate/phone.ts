import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { phoneKeySecret } from "@/lib/hash-keys";
import { logEvent } from "@/lib/log";

/*
 * A phone number the candidate chose to share when accepting an interview (dev/corporate-plan.md, call C). Stored on
 * the application encrypted (AES-256-GCM, bound to the application's id), so a database read alone doesn't show it and
 * a sealed value copied to another application doesn't open. Read back only for the people allowed to see it. It
 * never goes into logs, analytics, URLs or chat. Without a key (production with neither PHONE_KEY nor NAME_HASH_KEY)
 * nothing is sealed or opened and phone sharing is off.
 */

type Env = Record<string, string | undefined>;
const VERSION = "v2";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const keyOf = (env: Env): Buffer | null => {
  const secret = phoneKeySecret(env);
  return secret === null ? null : createHash("sha256").update(secret).digest();
};

/** Whether a phone can be shared now: false only when production has no key. */
export const phoneSharingAvailable = (env: Env = process.env): boolean => phoneKeySecret(env) !== null;

/** "v2:<iv>.<tag>.<ciphertext>", base64url, or null without a key. A new random IV each time. */
export function encryptPhone(phone: string, applicationId: string, env: Env = process.env): string | null {
  const key = keyOf(env);
  if (!key) {
    logEvent("warn", "phone_key_missing");
    return null;
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(applicationId, "utf8"));
  const body = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  return `${VERSION}:${[iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".")}`;
}

/** The number back, or null when the value is missing, altered, sealed with another key or for another application. */
export function decryptPhone(sealed: string | null, applicationId: string, env: Env = process.env): string | null {
  if (!sealed?.startsWith(`${VERSION}:`)) return null;
  const key = keyOf(env);
  if (!key) {
    logEvent("warn", "phone_key_missing");
    return null;
  }
  const parts = sealed.slice(VERSION.length + 1).split(".");
  if (parts.length !== 3) return null;
  const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
  if (iv!.length !== IV_BYTES || tag!.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv!, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(applicationId, "utf8"));
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(body!), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
