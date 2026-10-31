import { emailReady, sendEmail, weeklyFrom } from "@/lib/email/send";
import { errorFields, logEvent } from "@/lib/log";
import { APP_EMAIL_DIGEST_SHARE } from "@/lib/schemas/constants";
import { hasBearer } from "@/lib/secret";
import { runEventsDigests } from "@/lib/timetable/digest-store";

// As the weekly email: each Resend call takes at most 10 seconds, one person's send can take two of them, and no
// person starts after RUN_MS, so the run ends before this.
export const maxDuration = 60;
const RUN_MS = 30_000;

/** The app's own address for the email's links. */
const siteOf = (request: Request) =>
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(request.url).origin;

/**
 * The Monday events digest (Timetable PR 5, docs/plans/timetable-plan.md section 5), run by Vercel Cron Monday to
 * Wednesday in the hour before the weekly My jobs email (vercel.json; Hobby runs a cron some time within its hour, so
 * the two are an hour apart to keep the order). Monday sends; Tuesday and Wednesday pick up anyone the budget, a time
 * limit or a refused send left out, and skip anyone already sent this India week. Each send takes one from the shared
 * app-email budget with the digest's share as its cap (APP_EMAIL_DIGEST_SHARE, 20 of the day's 40), so the weekly email
 * always has the rest; it carries the idempotency key events-digest-<userId>-<week> and the one-click unsubscribe
 * headers, and the run stops at Resend's daily quota. Counts only in the logs: never a name, an address or an event.
 */
export async function GET(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401 });
  if (!emailReady()) {
    logEvent("info", "events_digest_skipped", { reason: "not_configured" });
    return Response.json({ ok: true, sent: 0 });
  }
  const from = weeklyFrom()!;
  try {
    const run = await runEventsDigests({
      site: siteOf(request),
      cap: APP_EMAIL_DIGEST_SHARE,
      deadline: Date.now() + RUN_MS,
      send: async (m) => {
        const sent = await sendEmail({
          to: m.to,
          from,
          subject: m.subject,
          text: m.text,
          html: m.html,
          // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from bulk senders.
          headers: { "List-Unsubscribe": `<${m.offUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          idempotencyKey: m.idempotencyKey,
        });
        return sent.ok ? { ok: true } : { ok: false, quota: sent.reason === "quota", maybeSent: sent.maybeSent === true };
      },
    });
    logEvent("info", "events_digest_done", run);
    return Response.json({ ok: true, ...run });
  } catch (error) {
    logEvent("error", "events_digest_failed", errorFields(error));
    return Response.json({ ok: false }, { status: 500 });
  }
}
