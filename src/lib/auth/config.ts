/** The public Supabase settings. Both are safe in the browser; the service key is never used. */
export type AuthConfig = { url: string; anonKey: string };

/** Null until the project's NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set: sign-in stays off. */
export function authConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    if (new URL(url).protocol !== "https:" && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) return null;
  } catch {
    return null;
  }
  return { url, anonKey };
}

/** True when the request carries a Supabase session cookie, so anonymous visitors skip every auth call. */
export function hasAuthCookie(names: string[]): boolean {
  return names.some((n) => n.startsWith("sb-") && n.includes("-auth-token"));
}

/**
 * Where to go after sign-in. Only paths on this site, so a crafted link can't send someone elsewhere
 * ("//evil.example" and "/\evil.example" are other hosts to a browser).
 */
export function safeNext(value: string | null | undefined, fallback = "/today"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
