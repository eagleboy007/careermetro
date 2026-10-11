import { randomBytes } from "node:crypto";
import { getDb } from "@/db";
import { consents, waitlistEntries } from "@/db/schema";
import { waitlistSignup } from "@/lib/schemas";
import { clientIp, isSameOrigin } from "@/lib/session";
import { addressKey, LIMITS, takeShared } from "@/lib/shared-limit";

const POLICY_VERSION = "2026-10-draft";

// The public site at careermetro.com is hosted apart from the app, and its early-access form posts here so every
// sign-up lands in the one waitlist. No other site may (T20).
const SITE_ORIGINS = new Set(["https://careermetro.com", "https://www.careermetro.com"]);

function siteOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  return origin && SITE_ORIGINS.has(origin) ? origin : null;
}

function corsHeaders(origin: string | null): HeadersInit {
  return origin
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "Origin" }
    : { vary: "Origin" };
}

/** The browser's check before the site's JSON post. Other origins get no CORS headers, so their post never leaves. */
export function OPTIONS(request: Request) {
  const origin = siteOrigin(request);
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) });
}

export async function POST(request: Request) {
  const origin = siteOrigin(request);
  const response = await signUp(request, !!origin);
  for (const [key, value] of Object.entries(corsHeaders(origin))) response.headers.set(key, value);
  return response;
}

async function signUp(request: Request, fromSite: boolean): Promise<Response> {
  // Only our own forms may record a consent: another site can't sign someone up (T20).
  if (!fromSite && !isSameOrigin(request)) return Response.json({ ok: false, error: "Please join from the CareerMetro website." }, { status: 403 });
  const body = await request.json().catch(() => null);

  // Honeypot: a hidden field people never fill in. Bots that do get the same reply as everyone else.
  if (body && typeof body === "object" && "website" in body && body.website) {
    return Response.json({ ok: true });
  }

  const parsed = waitlistSignup.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again" },
      { status: 400 },
    );
  }

  // Counted after the form checks, so only real sign-ups use the allowance (and touch the database).
  if (!(await takeShared(LIMITS.waitlistPerIp, addressKey(clientIp(request))))) {
    return Response.json({ ok: false, error: "Too many sign-ups from here. Please try again later." }, { status: 429 });
  }

  // Only the email and role are kept; anything else a form sends (the site also sends name and city) is dropped.
  const { email, role } = parsed.data;
  const db = getDb();
  const inserted = await db
    .insert(waitlistEntries)
    .values({ email, targetRole: role ?? null, confirmToken: randomBytes(24).toString("base64url") })
    .onConflictDoNothing({ target: waitlistEntries.email })
    .returning({ id: waitlistEntries.id });

  if (inserted.length > 0) {
    await db.insert(consents).values({ email, purpose: "waitlist_email", policyVersion: POLICY_VERSION });
    // Next step: send the double opt-in email with the confirm token (FR-28).
  }

  // Same reply whether or not the email was already on the list, so the form can't be used to check addresses.
  return Response.json({ ok: true });
}
