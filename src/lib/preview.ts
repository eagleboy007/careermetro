/**
 * The signed-in screens are still built on example data. They show on local and preview deployments, and in
 * production only when TODAY_PREVIEW=1, so nobody reaches them before sign-in exists.
 */
export function signedInPreviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TODAY_PREVIEW === "1" || env.VERCEL_ENV !== "production";
}

/**
 * The /design gallery shows unreviewed Elite content (draft follow-ups, playbooks, timed-test answers) as example data,
 * so it is served locally and on preview deployments (staging) only; production answers 404 (T73, FR-50).
 */
export function designGalleryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production";
}
