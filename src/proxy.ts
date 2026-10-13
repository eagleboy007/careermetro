import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin/access";
import { authConfig } from "@/lib/auth/config";
import { refreshSession } from "@/lib/auth/proxy-session";
import { TEST_USER_COOKIE, testSignInEnabled, testUserIdentity } from "@/lib/auth/test-user";
import { signedInPreviewEnabled } from "@/lib/preview";

/** Signed-in screens and the sign-in flow. Add new signed-in routes here. */
const SIGNED_IN_PREFIXES = ["/today", "/map", "/departures", "/arrivals", "/inbox", "/grievances", "/me", "/settings", "/u", "/account", "/sign-in", "/sign-up", "/auth"];
/** Screens that need someone signed in once sign-in is set up. */
const NEEDS_SIGN_IN = ["/today", "/map", "/departures", "/arrivals", "/inbox", "/me", "/settings", "/u", "/account/restore"];

/** CareerMetro's own admin pages: anyone who isn't an admin gets the normal not-found page, with a 404. */
const ADMIN_PREFIXES = ["/admin"];
/** No route lives here, so a rewrite to it renders the app's not-found page with a 404 status. */
export const NOT_FOUND_PATH = "/_no-such-page";

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
 * The normal not-found page, decided here before anything streams so the status is a real 404 (a notFound() inside
 * the streamed signed-in layout would answer 200). Keeps any cookies the session refresh wrote.
 */
function notFoundKeeping(request: NextRequest, response?: NextResponse): NextResponse {
  const out = NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  for (const cookie of response?.cookies.getAll() ?? []) out.cookies.set(cookie);
  return out;
}

/**
 * Runs before any render.
 * - Outside previews the signed-in screens answer a plain 404 here: a notFound() inside the streamed layout would
 *   already have sent a 200 with the page's data. Production does no auth work at all until sign-in launches.
 * - Elsewhere it refreshes the sign-in session (the only place a refresh can be saved), sends signed-out visitors
 *   from signed-in screens to /sign-in and signed-in visitors from the home page to /today.
 * - The admin pages answer not-found to everyone but an admin (src/lib/admin/access.ts): signed out included, so the
 *   page never shows it exists. The page and its actions check again themselves.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const adminPage = under(path, ADMIN_PREFIXES);
  if (!signedInPreviewEnabled()) {
    if (adminPage) return notFoundKeeping(request);
    return under(path, SIGNED_IN_PREFIXES) ? new NextResponse(null, { status: 404 }) : NextResponse.next();
  }
  const { response, signedIn: withProvider, identity: providerIdentity } = await refreshSession(request);
  // Until the real sign-in has its keys, previews use the stand-in test user instead.
  if (!authConfig() && !testSignInEnabled()) return adminPage ? notFoundKeeping(request, response) : response;
  const testUser = testUserIdentity(request.cookies.get(TEST_USER_COOKIE)?.value);
  const signedIn = withProvider || testUser !== null;
  if (adminPage && !isAdmin(providerIdentity ?? testUser)) return notFoundKeeping(request, response);
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
