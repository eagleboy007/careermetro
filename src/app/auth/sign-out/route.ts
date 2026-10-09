import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth/server";
import { isSameOrigin, SESSION_COOKIE } from "@/lib/session";

/** Signs out on this device. A form post from our own pages only, so another site can't sign people out. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new NextResponse(null, { status: 403 });
  await signOut();
  // The anonymous cookie goes too: its analyses now belong to the account, and the next visitor starts clean.
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/", request.url), 303);
}
