import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth/config";
import { refreshSession } from "@/lib/auth/proxy-session";
import { TEST_USER_COOKIE, testSignInEnabled, testUserIdentity } from "@/lib/auth/test-user";
import { signedInPreviewEnabled } from "@/lib/preview";

/** Signed-in screens and the sign-in flow. Add new signed-in routes here. */
const SIGNED_IN_PREFIXES = ["/today", "/map", "/sign-in", "/sign-up", "/auth"];
/** Screens that need someone signed in once sign-in is set up. */
const NEEDS_SIGN_IN = ["/today", "/map"];

const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

/** A redirect that keeps any cookies the session refresh just wrote. */
function redirectKeeping(response: NextResponse, url: URL): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  // A refreshed session must not be cached on the way back.
  for (const name of ["cache-control", "expires", "pragma"]) {
    const value = response.headers.get(name);
    if (value) redirect.headers.set(name, value);
  }
  return redirect;
}

/**
 * Runs before any render.
 * - Outside previews the signed-in screens answer a plain 404 here: a notFound() inside the streamed layout would
 *   already have sent a 200 with the page's data. Production does no auth work at all until sign-in launches.
 * - Elsewhere it refreshes the sign-in session (the only place a refresh can be saved), sends signed-out visitors
 *   from signed-in screens to /sign-in and signed-in visitors from the home page to /today.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!signedInPreviewEnabled()) {
    return under(path, SIGNED_IN_PREFIXES) ? new NextResponse(null, { status: 404 }) : NextResponse.next();
  }
  const { response, signedIn: withProvider } = await refreshSession(request);
  // Until the real sign-in has its keys, previews use the stand-in test user instead.
  if (!authConfig() && !testSignInEnabled()) return response;
  const signedIn = withProvider || testUserIdentity(request.cookies.get(TEST_USER_COOKIE)?.value) !== null;
  if (!signedIn && under(path, NEEDS_SIGN_IN)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", path + request.nextUrl.search);
    return redirectKeeping(response, url);
  }
  if (signedIn && (path === "/" || path === "/sign-in")) return redirectKeeping(response, new URL("/today", request.url));
  return response;
}

export const config = {
  // Every page, so a session can be refreshed wherever it is read. API routes can set cookies themselves, and leaving
  // them out keeps uploads from passing through the proxy.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)"],
};
