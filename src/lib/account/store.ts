import "server-only";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { consents, resumes, users } from "@/db/schema";
import { ANONYMOUS_TTL_HOURS } from "@/lib/owner";
import { WEEKLY_HOURS } from "@/lib/schemas";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const ACCOUNT_POLICY_VERSION = "2026-10-draft";

/**
 * What the sign-in provider tells us about a signed-in person. Nothing else from the provider is stored.
 * `emailVerified` is true when the provider proved the person controls the email (Google, or an emailed code).
 */
export type Identity = { subject: string; email: string; emailVerified: boolean; name: string | null };

export type Account = { id: string; email: string; name: string | null; weeklyHours: number };

const normalEmail = (email: string) => email.trim().toLowerCase();

/** Our user for this sign-in, or null before they finish sign-up. */
export async function findAccount(subject: string, db: Pick<Db, "select"> = getDb()): Promise<Account | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, weeklyHours: users.weeklyHours })
    .from(users)
    .where(eq(users.authSubject, subject))
    .limit(1);
  return row ?? null;
}

/**
 * Moves this browser's anonymous analyses (FR-2) to the user: resume, gaps and path follow, since they hang off the
 * resume, and the upload consent is linked to the user too. Only unclaimed resumes within their 24 hours move. Once
 * claimed, the session no longer reaches them (see `ownsResume`); the session id stays only so the session's daily
 * limits still count them.
 */
export async function claimAnonymousResumes(userId: string, sessionId: string, db: Db | Tx = getDb()): Promise<number> {
  const claimed = await db
    .update(resumes)
    .set({ userId })
    .where(
      and(
        eq(resumes.anonymousSessionId, sessionId),
        isNull(resumes.userId),
        gt(resumes.createdAt, new Date(Date.now() - ANONYMOUS_TTL_HOURS * 3600_000)),
      ),
    )
    .returning({ id: resumes.id, consentId: resumes.consentId });
  const consentIds = claimed.flatMap((r) => (r.consentId ? [r.consentId] : []));
  if (consentIds.length) await db.update(consents).set({ userId }).where(and(inArray(consents.id, consentIds), isNull(consents.userId)));
  return claimed.length;
}

export type CreateAccountResult = { ok: true; account: Account } | { ok: false; reason: "email_taken" | "email_unverified" };

/**
 * Finishes sign-up after the person ticked "I am 18 or older": creates the user (or links an existing one with the
 * same verified email and no sign-in yet, for a later change of provider), records the account consent and claims
 * this browser's anonymous analyses. Safe to call twice: a second call claims and returns the same account.
 */
export async function createAccount(
  identity: Identity,
  input: { name: string | null; sessionId: string | null },
  db: Db = getDb(),
): Promise<CreateAccountResult> {
  const email = normalEmail(identity.email);
  return db.transaction(async (tx) => {
    // One sign-up per sign-in and per email at a time, so two tabs can't both insert. Always subject, then email.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-account-sub:${identity.subject}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-account:${email}`}))`);
    const existing = await findAccount(identity.subject, tx);
    if (existing) {
      if (input.sessionId) await claimAnonymousResumes(existing.id, input.sessionId, tx);
      return { ok: true, account: existing } as const;
    }

    const [byEmail] = await tx
      .select({ id: users.id, authSubject: users.authSubject })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (byEmail?.authSubject) return { ok: false, reason: "email_taken" } as const;
    // Linking hands over an existing user's data, so only a proven email may do it.
    if (byEmail && !identity.emailVerified) return { ok: false, reason: "email_unverified" } as const;

    const now = new Date();
    const values = { authSubject: identity.subject, name: input.name, ageConfirmedAt: now, lastSeenAt: now };
    const [row] = byEmail
      ? await tx.update(users).set({ email, ...values }).where(eq(users.id, byEmail.id)).returning({ id: users.id, email: users.email, name: users.name, weeklyHours: users.weeklyHours })
      : await tx.insert(users).values({ email, ...values }).returning({ id: users.id, email: users.email, name: users.name, weeklyHours: users.weeklyHours });
    await tx.insert(consents).values({ userId: row.id, email, purpose: "account", policyVersion: ACCOUNT_POLICY_VERSION });
    if (input.sessionId) await claimAnonymousResumes(row.id, input.sessionId, tx);
    return { ok: true, account: row } as const;
  });
}

/** Records a visit, at most once a day, for the inactive-account policy. */
export async function touchLastSeen(userId: string, db: Db = getDb()): Promise<void> {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  await db
    .update(users)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(users.id, userId), or(isNull(users.lastSeenAt), lt(users.lastSeenAt, dayAgo))));
}

/** Saves how many hours a week the person has for learning; only the offered choices are kept. */
export async function setWeeklyHours(userId: string, hours: number, db: Pick<Db, "update"> = getDb()): Promise<boolean> {
  if (!(WEEKLY_HOURS as readonly number[]).includes(hours)) return false;
  const rows = await db.update(users).set({ weeklyHours: hours }).where(eq(users.id, userId)).returning({ id: users.id });
  return rows.length > 0;
}
