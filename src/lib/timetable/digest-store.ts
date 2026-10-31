import "server-only";
import { and, asc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { eventsDigests, users, userSettings } from "@/db/schema";
import { giveBackAppEmail, takeAppEmail } from "@/lib/email/budget";
import { newOffToken, OFF_TOKEN, offTokenFor } from "@/lib/my-jobs/weekly-store";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import { DEFAULT_SETTINGS, eventsDigestInput, type EventsDigestView } from "@/lib/schemas";
import { APP_EMAIL_DIGEST_SHARE } from "@/lib/schemas/constants";
import { digestEmail, digestView, type DigestEmail } from "./digest";
import { timetableFor } from "./match";
import { liveEventsFor, timetablePersonFor } from "./store";

type Db = ReturnType<typeof getDb>;

/*
 * The Monday events digest's reads and writes (Timetable PR 5, docs/plans/timetable-plan.md section 5). Nothing here
 * logs: event titles, organisers, names and addresses never reach a log, and the off token is never logged either.
 */

/**
 * One person's digest for the week of `now`: their timetable under the radius and Include online they saved (the
 * same matches as /timetable and Today's teaser), cut to the next 7 days. Null when nothing matches: no email.
 */
export async function digestFor(userId: string, { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<EventsDigestView | null> {
  const { person } = await timetablePersonFor(userId, db);
  const view = timetableFor(await liveEventsFor(userId, person, now, db), person, now);
  return digestView(view.groups.flatMap((g) => g.events), now);
}

/** Whether the person turned on "Send me this week's events". Off with no row, as the weekly email is. */
export async function eventsDigestOn(userId: string, db: Pick<Db, "select"> = getDb()): Promise<boolean> {
  const [row] = await db.select({ on: userSettings.eventsDigest }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row?.on ?? false;
}

/**
 * "Send me this week's events" on or off, from /timetable or Settings > Notifications. Writes the person's own row
 * only; a first save makes the settings row with a new user's other defaults (DEFAULT_SETTINGS), as the job-search
 * switch does, since the visibility column's own default is still "Only you". Sends nothing.
 */
export async function setEventsDigest(userId: string, raw: unknown, { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<{ ok: true } | { ok: false; error: "invalid" }> {
  const input = eventsDigestInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { visibility, ...rest } = DEFAULT_SETTINGS;
  await db
    .insert(userSettings)
    .values({ userId, profileVisibility: visibility, ...rest, eventsDigest: input.data.on, updatedAt: now })
    .onConflictDoUpdate({ target: userSettings.userId, set: { eventsDigest: input.data.on, updatedAt: now } });
  return { ok: true };
}

/**
 * "Turn it off" from the digest: turns the digest off. The token is replaced, so the link works once, unless the weekly
 * My jobs email is still on: it carries the same token, and its off link must keep working. Answers nothing whatever
 * happened, so the page never says whether a token existed.
 */
export async function turnOffEventsDigest(token: string, db: Db = getDb()): Promise<void> {
  if (!OFF_TOKEN.test(token)) return;
  await db
    .update(userSettings)
    .set({ eventsDigest: false, emailOffToken: sql`case when ${userSettings.emailWeeklySummary} then ${userSettings.emailOffToken} else ${newOffToken()} end` })
    .where(eq(userSettings.emailOffToken, token));
}

export type DigestRun = { considered: number; sent: number; empty: number; failed: number; capped: boolean };
/**
 * Sends one digest with its idempotency key. `quota`: the sender's daily quota is spent, so the run stops and the next
 * day picks up the rest. `maybeSent`: it may have gone out anyway (a timeout or a server error).
 */
export type DigestSend = (message: DigestEmail & { to: string; offUrl: string; idempotencyKey: string }) => Promise<{ ok: boolean; quota?: boolean; maybeSent?: boolean }>;

/** The idempotency key for one person's digest: the sender sends it at most once within 24 hours. */
export const digestKey = (userId: string, week: string) => `events-digest-${userId}-${week}`;

/**
 * One cron run (Monday to Wednesday, before the weekly email): everyone with the digest on and no digest yet this India
 * week gets one, when an event matches in the next 7 days. People go in the order of the last week they had one (never
 * first, then the longest ago), then id.
 *
 * The budget: each send takes one from the shared app-email budget (src/lib/email/budget.ts) with `cap`, which is at
 * most APP_EMAIL_DIGEST_SHARE, so the digest never brings the India day's count of app emails past 20 and the weekly
 * email gets the rest. The run itself also stops after `cap` emails taken, whatever the database says.
 *
 * At most one digest a person a week, as the weekly email: before sending, the run takes one from the budget and claims
 * the person's week row, so another run skips them. A send refused outright gives both back and the next day tries
 * again; an unsure send is tried once more with the same idempotency key, and if that is unsure too the claim and the
 * budget stay (the person may miss a week but never gets two). A week with no event gets no row, so `digestWeeks` in
 * Download your data lists only weeks a digest went out, and Tuesday or Wednesday can still send if an event appears.
 * Stops before `deadline`, when the budget is spent, or at Resend's daily quota. Counts only.
 */
export async function runEventsDigests({
  db = getDb(),
  now = new Date(),
  cap = APP_EMAIL_DIGEST_SHARE,
  site,
  send,
  deadline = Number.POSITIVE_INFINITY,
  only,
}: {
  db?: Db;
  now?: Date;
  cap?: number;
  site: string;
  send: DigestSend;
  deadline?: number;
  /** Only these people (tests, where the database holds others). */
  only?: string[];
}): Promise<DigestRun> {
  const share = Math.max(0, Math.min(cap, APP_EMAIL_DIGEST_SHARE));
  const week = mondayOf(indiaDay(now));
  const lastWeek = sql`(select max(${eventsDigests.week}) from ${eventsDigests} where ${eventsDigests.userId} = ${users.id})`;
  const people = await db
    .select({ id: users.id, email: users.email, firstName: users.firstName })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(
      and(
        eq(userSettings.eventsDigest, true),
        isNull(users.deletionRequestedAt),
        isNull(users.suspendedAt),
        only ? inArray(users.id, only) : undefined,
        notExists(db.select({ one: sql`1` }).from(eventsDigests).where(and(eq(eventsDigests.userId, users.id), eq(eventsDigests.week, week)))),
      ),
    )
    .orderBy(sql`${lastWeek} asc nulls first`, asc(users.id));
  const run: DigestRun = { considered: 0, sent: 0, empty: 0, failed: 0, capped: false };
  let taken = 0;
  for (const person of people) {
    if (Date.now() > deadline) {
      run.capped = true;
      break;
    }
    if (taken >= share) {
      run.capped = true;
      break;
    }
    run.considered++;
    try {
      const view = await digestFor(person.id, { db, now });
      if (!view) {
        run.empty++;
        continue;
      }
      const offUrl = `${site}/api/email/off?t=${await offTokenFor(person.id, db)}&k=events`;
      const email = digestEmail(view, { name: person.firstName, site, offUrl });
      const day = await takeAppEmail({ db, now, cap: share });
      if (!day) {
        run.capped = true;
        break;
      }
      taken++;
      const claimed = await db.insert(eventsDigests).values({ userId: person.id, week, sentAt: now }).onConflictDoNothing().returning({ week: eventsDigests.week });
      if (!claimed.length) {
        // Another run claimed this person's week since the list was read.
        await giveBackAppEmail(day, db);
        taken--;
        continue;
      }
      const message = { ...email, to: person.email, offUrl, idempotencyKey: digestKey(person.id, week) };
      let result = await send(message);
      if (!result.ok && result.maybeSent) result = await send(message);
      if (result.ok) {
        run.sent++;
        continue;
      }
      run.failed++;
      if (result.maybeSent) continue;
      // Refused outright, so nothing went out: free the week and the budget for the next run.
      await db.delete(eventsDigests).where(and(eq(eventsDigests.userId, person.id), eq(eventsDigests.week, week)));
      await giveBackAppEmail(day, db);
      taken--;
      if (result.quota) {
        run.capped = true;
        break;
      }
    } catch {
      run.failed++;
    }
  }
  return run;
}
