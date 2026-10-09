import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, hasAuthCookie } from "./config";

/**
 * Runs in the proxy before any render: refreshes an expiring session and writes the new cookies to both the request
 * (for this render) and the response (for the browser). Server components can't write cookies, so this is the one
 * place a refresh can be saved. Visitors without a session cookie skip it, with no network call.
 * Returns the response to send on and whether someone is signed in.
 */
export async function refreshSession(request: NextRequest): Promise<{ response: NextResponse; signedIn: boolean }> {
  let response = NextResponse.next({ request });
  const config = authConfig();
  if (!config || !hasAuthCookie(request.cookies.getAll().map((c) => c.name))) return { response, signedIn: false };

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  // getClaims verifies the token and refreshes it when it has expired. Nothing may run between creating the client
  // and this call, or a refresh can be lost and sign the person out.
  const { data } = await supabase.auth.getClaims();
  return { response, signedIn: Boolean(data?.claims?.sub) };
}
