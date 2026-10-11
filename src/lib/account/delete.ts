import "server-only";
import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, consents, users, waitlistEntries } from "@/db/schema";
import { removeEmptyChats } from "@/lib/inbox/store";
import { errorFields, logEvent } from "@/lib/log";

type Db = ReturnType<typeof getDb>;

/** How long a deleted account is kept, hidden, so it can be restored (Milin, 2026-10-10). */
export const DELETE_GRACE_DAYS = 30;

const graceEnds = (now: Date) => new Date(now.getTime() - DELETE_GRACE_DAYS * 86_400_000);

/**
 * Marks the account deleted. From now on it counts as signed out everywhere, and its data is kept, hidden, for
 * DELETE_GRACE_DAYS in case the person changes their mind. Only the date is logged, never who.
 */
export async function requestDeletion(userId: string, db: Db = getDb(), now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ deletionRequestedAt: now })
      .where(and(eq(users.id, userId), isNull(users.deletionRequestedAt)))
      .returning({ id: users.id });
    if (rows.length) await tx.insert(auditLogs).values({ actor: "user", action: "account_delete_requested", target: "account" });
    return rows.length > 0;
  });
}

/** Brings a deleted account back while it is still within its grace period. */
export async function restoreAccount(userId: string, db: Db = getDb(), now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ deletionRequestedAt: null })
      .where(and(eq(users.id, userId), isNotNull(users.deletionRequestedAt), gte(users.deletionRequestedAt, graceEnds(now))))
      .returning({ id: users.id });
    if (rows.length) await tx.insert(auditLogs).values({ actor: "user", action: "account_restored", target: "account" });
    return rows.length > 0;
  });
}

/** The last day a deleted account can be restored, or null when it isn't deleted. */
export const restoreUntil = (deletionRequestedAt: Date | null): Date | null =>
  deletionRequestedAt ? new Date(deletionRequestedAt.getTime() + DELETE_GRACE_DAYS * 86_400_000) : null;

/**
 * The daily job: removes accounts deleted more than DELETE_GRACE_DAYS ago, for good. Deleting the user row removes
 * everything that hangs off it (resumes, profiles, analyses, paths, goals, proofs, ride days, consents, their messages,
 * chat memberships and blocks; chats nobody is left in go too, and reports they filed stay without their name); a waitlist
 * sign-up with the same email goes too. The sign-in identity goes when the database has Supabase's auth schema; if
 * that step fails, our data is still removed and the failure is logged. One audit line per account, with no personal
 * data.
 */
export async function purgeDeletedAccounts(db: Db = getDb(), now = new Date()): Promise<number> {
  const due = await db
    .select({ id: users.id, email: users.email, authSubject: users.authSubject, deletionRequestedAt: users.deletionRequestedAt })
    .from(users)
    .where(lt(users.deletionRequestedAt, graceEnds(now)));
  let purged = 0;
  for (const user of due) {
    // Days past its 30, so a failure that repeats can be told apart from a new one without naming anyone.
    const overdueDays = Math.floor((graceEnds(now).getTime() - user.deletionRequestedAt!.getTime()) / 86_400_000);
    try {
      await db.transaction(async (tx) => {
        const gone = await tx
          .delete(users)
          .where(and(eq(users.id, user.id), lt(users.deletionRequestedAt, graceEnds(now))))
          .returning({ id: users.id });
        // Restored in the meantime.
        if (!gone.length) return;
        await removeEmptyChats(tx);
        const email = user.email.toLowerCase();
        await tx.delete(waitlistEntries).where(sql`lower(${waitlistEntries.email}) = ${email}`);
        await tx.delete(consents).where(and(isNull(consents.userId), sql`lower(${consents.email}) = ${email}`));
        try {
          // A savepoint: if the sign-in can't be removed, our own data still goes.
          await tx.transaction((sp) => deleteSignInIdentity(sp, user.authSubject));
        } catch (error) {
          logEvent("error", "account_purge_sign_in_failed", { overdueDays, ...errorFields(error) });
        }
        await tx.insert(auditLogs).values({ actor: "system", action: "account_deleted", target: "account" });
        purged++;
      });
    } catch (error) {
      logEvent("error", "account_purge_failed", { overdueDays, ...errorFields(error) });
    }
  }
  return purged;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Removes the person's Supabase sign-in, when this database has it. Test users ("test:…") have none. */
async function deleteSignInIdentity(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], subject: string | null) {
  if (!subject || !UUID.test(subject)) return;
  const [{ present }] = await tx.execute<{ present: boolean }>(sql`select to_regclass('auth.users') is not null as present`);
  if (present) await tx.execute(sql`delete from auth.users where id = ${subject}::uuid`);
}
