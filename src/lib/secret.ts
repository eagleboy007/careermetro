import { createHash, timingSafeEqual } from "node:crypto";

/**
 * True when the request carries `Authorization: Bearer <secret>`. Compared in constant time over fixed-length
 * digests, so neither the secret's content nor its length leaks through timing. False when no secret is set.
 */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const sent = request.headers.get("authorization") ?? "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(sent), digest(`Bearer ${secret}`));
}
