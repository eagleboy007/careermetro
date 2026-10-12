import { createHmac } from "node:crypto";
import { credentialHashKey } from "@/lib/hash-keys";

/**
 * A keyed hash of a certificate's credential id, so "one certificate, one account" can be checked without keeping
 * the id readable. Case, spaces and separators are ignored, so "ab-12 34" and "AB1234" are the same credential.
 */
export function credentialKey(certId: string, credentialId: string, env: Record<string, string | undefined> = process.env): string {
  const plain = credentialId.normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return createHmac("sha256", credentialHashKey(env)).update(`${certId}|${plain}`).digest("base64url");
}
