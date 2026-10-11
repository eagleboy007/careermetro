/**
 * True when the app talks to the stand-in Claude API (`node e2e/mock-ai.mjs`, docs/local-setup.md) on this machine.
 * The stand-in reads every resume as the same sample profile, so screens that show a reading say so. Never true on
 * production.
 */
export function localMockActive(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === "production" || !env.ANTHROPIC_BASE_URL) return false;
  try {
    const host = new URL(env.ANTHROPIC_BASE_URL).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}
