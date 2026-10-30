import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appEmailDays } from "@/db/schema";
import { indiaDay } from "@/lib/ride/days";
import { APP_EMAIL_DAILY_BUDGET } from "@/lib/schemas/constants";

type Db = ReturnType<typeof getDb>;

/*
 * The shared app-email budget (T151, T153). Resend's free plan allows 100 emails a day; sign-in codes keep 60, and
 * the app's own bulk emails (the weekly My jobs email now, the Monday events digest later) share
 * APP_EMAIL_DAILY_BUDGET an India day, counted in app_email_days. Work-email codes are one-off and not counted here.
 * Counts only: nothing about a person or an email is kept or logged.
 */

/**
 * Takes one email from today's budget (India day of `now`), while fewer than `cap` have gone out today. One statement
 * adds the email only while the count is under the cap and returns the row, so two runs can't both take the last one.
 * Answers the day it was taken from (to give it back on a refused send), or null when the day's budget is spent.
 * `cap` is the most the caller may bring the day's count to: the weekly email passes the whole budget, the digest its
 * share, so the digest, which runs first on Mondays, leaves the rest for the weekly email.
 */
export async function takeAppEmail({ db = getDb(), now = new Date(), cap = APP_EMAIL_DAILY_BUDGET }: { db?: Db; now?: Date; cap?: number } = {}): Promise<string | null> {
  const limit = Math.min(cap, APP_EMAIL_DAILY_BUDGET);
  if (limit < 1) return null;
  const day = indiaDay(now);
  const rows = await db
    .insert(appEmailDays)
    .values({ day, sent: 1 })
    .onConflictDoUpdate({
      target: appEmailDays.day,
      set: { sent: sql`${appEmailDays.sent} + 1`, updatedAt: sql`now()` },
      setWhere: lt(appEmailDays.sent, limit),
    })
    .returning({ sent: appEmailDays.sent });
  return rows.length ? day : null;
}

/** Gives back one email taken from `day`, after Resend refused the send outright (so nothing went out). Never below 0. */
export async function giveBackAppEmail(day: string, db: Db = getDb()): Promise<void> {
  await db
    .update(appEmailDays)
    .set({ sent: sql`greatest(${appEmailDays.sent} - 1, 0)`, updatedAt: sql`now()` })
    .where(eq(appEmailDays.day, day));
}

/** How many app emails went out on the India day of `now` (tests and admin reads). */
export async function appEmailsSent({ db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<number> {
  const [row] = await db.select({ sent: appEmailDays.sent }).from(appEmailDays).where(eq(appEmailDays.day, indiaDay(now))).limit(1);
  return row?.sent ?? 0;
}
