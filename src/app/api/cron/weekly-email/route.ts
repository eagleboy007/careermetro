import { emailReady, sendEmail, weeklyFrom } from "@/lib/email/send";
import { errorFields, logEvent } from "@/lib/log";
import { runWeeklyEmails } from "@/lib/my-jobs/weekly-store";
import { APP_EMAIL_DAILY_BUDGET } from "@/lib/schemas/constants";
import { hasBearer } from "@/lib/secret";

// Each Resend call takes at most 10 seconds, and one person's send can take two of them (an unsure first try is tried
// once more with the same idempotency key) plus a few seconds of rate-limit waits; no person starts after RUN_MS, so
// the run ends before this and the next day can go on.
export const maxDuration = 60;
const RUN_MS = 30_000;

/** The app's own address for the email's links. */
const siteOf = (request: Request) =>
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(request.url).origin;

/**
 * The weekly My jobs email (C22, docs/plans/application-tracker-plan.md section 6), run by Vercel Cron at 08:00 IST
 * Monday to Wednesday (vercel.json). Monday sends; Tuesday and Wednesday pick up anyone the budget, a time limit or a
 * refused send left out, and skip anyone already sent this India week. Each send takes one from the shared app-email
 * budget, APP_EMAIL_DAILY_BUDGET an India day (Resend's free plan allows 100 a day and sign-in codes keep 60; T142,
 * T151, T153), carries the idempotency key weekly-<userId>-<week>, waits and tries again on Resend's per-second rate
 * limit, and the run stops at Resend's daily quota. Counts only in the logs: never a name, an address or a job.
 */
export async function GET(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401 });
  if (!emailReady()) {
    logEvent("info", "weekly_email_skipped", { reason: "not_configured" });
    return Response.json({ ok: true, sent: 0 });
  }
  const from = weeklyFrom()!;
  try {
    const run = await runWeeklyEmails({
      site: siteOf(request),
      cap: APP_EMAIL_DAILY_BUDGET,
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
    logEvent("info", "weekly_email_done", run);
    return Response.json({ ok: true, ...run });
  } catch (error) {
    logEvent("error", "weekly_email_failed", errorFields(error));
    return Response.json({ ok: false }, { status: 500 });
  }
}
