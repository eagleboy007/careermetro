import "server-only";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { consents, resumes, users } from "@/db/schema";
import { ANONYMOUS_TTL_HOURS } from "@/lib/owner";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const ACCOUNT_POLICY_VERSION = "2026-10-draft";

/** What the sign-in provider tells us about a signed-in person. Nothing else from the provider is stored. */
export type Identity = { subject: string; email: string; name: string | null };

export type Account = { id: string; email: string; name: string | null };

const normalEmail = (email: string) => email.trim().toLowerCase();

/** Our user for this sign-in, or null before they finish sign-up. */
export async function findAccount(subject: string, db: Pick<Db, "select"> = getDb()): Promise<Account | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.authSubject, subject))
    .limit(1);
  return row ?? null;
}

/**
 * Moves this browser's anonymous analyses (FR-2) to the user: resume, gaps and path follow, since they hang off the
 * resume. Only unclaimed resumes within their 24 hours move. The session id is cleared, so the old cookie no longer
 * reaches them after sign-out.
 */
export async function claimAnonymousResumes(userId: string, sessionId: string, db: Db | Tx = getDb()): Promise<number> {
  const claimed = await db
    .update(resumes)
    .set({ userId, anonymousSessionId: null })
    .where(
      and(
        eq(resumes.anonymousSessionId, sessionId),
        isNull(resumes.userId),
        gt(resumes.createdAt, new Date(Date.now() - ANONYMOUS_TTL_HOURS * 3600_000)),
      ),
    )
    .returning({ id: resumes.id });
  return claimed.length;
}

export type CreateAccountResult = { ok: true; account: Account } | { ok: false; reason: "email_taken" };

/**
 * Finishes sign-up after the person ticked "I am 18 or older": creates the user (or links an existing one with the
 * same email and no sign-in yet, for a later change of provider), records the account consent and claims this
 * browser's anonymous analyses. Safe to call twice: a second call returns the same account.
 */
export async function createAccount(
  identity: Identity,
  input: { name: string | null; sessionId: string | null },
  db: Db = getDb(),
): Promise<CreateAccountResult> {
  const email = normalEmail(identity.email);
  return db.transaction(async (tx) => {
    // One sign-up per email at a time, so two tabs can't both insert.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-account:${email}`}))`);
    const existing = await findAccount(identity.subject, tx);
    if (existing) return { ok: true, account: existing } as const;

    const [byEmail] = await tx
      .select({ id: users.id, authSubject: users.authSubject })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (byEmail?.authSubject) return { ok: false, reason: "email_taken" } as const;

    const now = new Date();
    const values = { authSubject: identity.subject, name: input.name, ageConfirmedAt: now, lastSeenAt: now };
    const [row] = byEmail
      ? await tx.update(users).set(values).where(eq(users.id, byEmail.id)).returning({ id: users.id, email: users.email, name: users.name })
      : await tx.insert(users).values({ email, ...values }).returning({ id: users.id, email: users.email, name: users.name });
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
