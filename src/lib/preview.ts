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

/**
 * Junction, the community board (docs/plans/junction-plan.md, FR-61): off everywhere, previews and production alike,
 * unless JUNCTION_ENABLED is exactly "1". Production runs with TODAY_PREVIEW=1, so the preview gate alone would open it.
 * Every Junction screen, action, nav entry and legal-page section checks this; the admin side of moderation doesn't, so
 * it can be tried before anyone can post. Read at request time on the server.
 */
export function junctionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.JUNCTION_ENABLED?.trim() === "1";
}
