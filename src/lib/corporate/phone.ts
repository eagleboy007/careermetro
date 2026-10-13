import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { phoneKeySecret } from "@/lib/hash-keys";

/*
 * A phone number the candidate chose to share when accepting an interview (dev/corporate-plan.md, call C). Stored on
 * the application encrypted (AES-256-GCM), so a database read alone doesn't show it, and read back only for the
 * interview's team. It never goes into logs, analytics, URLs or chat.
 */

type Env = Record<string, string | undefined>;
const VERSION = "v1";

const key = (env: Env) => createHash("sha256").update(phoneKeySecret(env)).digest();

/** "v1:<iv>.<tag>.<ciphertext>", base64url. A new random IV each time, so the same number never reads the same. */
export function encryptPhone(phone: string, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const body = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  return `${VERSION}:${[iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".")}`;
}

/** The number back, or null when the value is missing, altered or sealed with another key. */
export function decryptPhone(sealed: string | null, env: Env = process.env): string | null {
  if (!sealed?.startsWith(`${VERSION}:`)) return null;
  const parts = sealed.slice(VERSION.length + 1).split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(env), iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(body!), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
