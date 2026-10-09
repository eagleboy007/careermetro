import { NextResponse } from "next/server";
import { afterSignIn } from "@/lib/auth/after-sign-in";
import { safeNext } from "@/lib/auth/config";
import { completeGoogleRedirect } from "@/lib/auth/server";

/** Where Google comes back to: sets the session, then on to sign-up or where they were heading. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const result = await completeGoogleRedirect(url.searchParams.get("code"));
  if (!result.ok) return NextResponse.redirect(new URL(`/sign-in?error=link&next=${encodeURIComponent(next)}`, url));
  return NextResponse.redirect(new URL(await afterSignIn(next), url));
}
