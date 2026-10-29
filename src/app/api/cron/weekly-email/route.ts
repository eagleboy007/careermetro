import { emailReady, sendEmail, weeklyFrom } from "@/lib/email/send";
import { errorFields, logEvent } from "@/lib/log";
import { runWeeklyEmails, WEEKLY_EMAIL_CAP } from "@/lib/my-jobs/weekly-store";
import { hasBearer } from "@/lib/secret";

// Each send is one Resend call of at most 10 seconds; the run stops well before this so the next day can go on.
export const maxDuration = 60;
const RUN_MS = 45_000;

/** The app's own address for the email's links. */
const siteOf = (request: Request) =>
  process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : new URL(request.url).origin;

/**
 * The weekly My jobs email (C22, docs/plans/application-tracker-plan.md section 6), run by Vercel Cron at 08:00 IST
 * Monday to Wednesday (vercel.json). Monday sends; Tuesday and Wednesday pick up anyone a cap, a time limit or a failed
 * send left out, and skip anyone already sent this India week. Up to WEEKLY_EMAIL_CAP a run, because Resend's free plan
 * allows 100 a day, shared with sign-in codes, and stops at Resend's limit (T142). Counts only in the logs: never a name, an address or a job.
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
      cap: WEEKLY_EMAIL_CAP,
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
        });
        return { ok: sent.ok, limited: !sent.ok && sent.reason === "limited" };
      },
    });
    logEvent("info", "weekly_email_done", run);
    return Response.json({ ok: true, ...run });
  } catch (error) {
    logEvent("error", "weekly_email_failed", errorFields(error));
    return Response.json({ ok: false }, { status: 500 });
  }
}
