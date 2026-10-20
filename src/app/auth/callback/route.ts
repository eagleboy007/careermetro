import { NextResponse } from "next/server";
import { afterSignIn } from "@/lib/auth/after-sign-in";
import { googleSignInEnabled, safeNext } from "@/lib/auth/config";
import { completeGoogleRedirect } from "@/lib/auth/server";

/** Where Google comes back to: sets the session, then on to sign-up or where they were heading. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const refused = () => NextResponse.redirect(new URL(`/sign-in?error=link&next=${encodeURIComponent(next)}`, url));
  // Google sign-in off (GOOGLE_SIGNIN): the return is refused too, not only the button (Testing Run 5, T92).
  if (!googleSignInEnabled()) return refused();
  const result = await completeGoogleRedirect(url.searchParams.get("code"));
  if (!result.ok) return refused();
  return NextResponse.redirect(new URL(await afterSignIn(next), url));
}
