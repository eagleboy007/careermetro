import { randomBytes } from "node:crypto";
import { getDb } from "@/db";
import { consents, waitlistEntries } from "@/db/schema";
import { windowLimiter } from "@/lib/rate-limit";
import { waitlistSignup } from "@/lib/schemas";
import { clientHash, clientIp, isSameOrigin } from "@/lib/session";

const POLICY_VERSION = "2026-10-draft";

/** Sign-ups per client per hour on one server instance: enough for a family on one connection, not for a script. */
const signups = windowLimiter(10, 60 * 60 * 1000);

export async function POST(request: Request) {
  // Only our own form may record a consent: another site can't sign someone up (T20).
  if (!isSameOrigin(request)) return Response.json({ ok: false, error: "Please join from the CareerMetro website." }, { status: 403 });
  if (!signups.take(clientHash(clientIp(request)))) {
    return Response.json({ ok: false, error: "Too many sign-ups from here. Please try again later." }, { status: 429 });
  }
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
