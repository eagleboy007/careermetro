/**
 * The signed-in screens are still built on example data. They show on local and preview deployments, and in
 * production only when TODAY_PREVIEW=1, so nobody reaches them before sign-in exists.
 */
export function signedInPreviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TODAY_PREVIEW === "1" || env.VERCEL_ENV !== "production";
}
