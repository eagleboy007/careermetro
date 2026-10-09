import { NextResponse } from "next/server";
import { signedInPreviewEnabled } from "@/lib/preview";

/**
 * Runs before any render. The signed-in screens still run on example data, so outside previews they answer a plain
 * 404 here: a notFound() inside the streamed layout would already have sent a 200 with the page's data.
 */
export function proxy() {
  if (!signedInPreviewEnabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: ["/today", "/today/:path*"] };
