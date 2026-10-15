import "server-only";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { consents, resumes, users } from "@/db/schema";
import { ANONYMOUS_TTL_HOURS } from "@/lib/owner";
import { checkName, hasUsableName } from "@/lib/resume/name-match";
import { WEEKLY_HOURS } from "@/lib/schemas";
import { fullName } from "./name";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const ACCOUNT_POLICY_VERSION = "2026-10-draft";

/**
 * What the sign-in provider tells us about a signed-in person. Nothing else from the provider is stored.
 * `emailVerified` is true when the provider proved the person controls the email (Google, or an emailed code).
 */
export type Identity = {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** How they signed in, for Account settings. Absent when the provider didn't say. */
  method?: SignInMethod;
};

export type SignInMethod = "google" | "email_code" | "test";

export type Account = {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  weeklyHours: number;
  /** Set while a deleted account waits out its grace period (src/lib/account/delete.ts); it then counts as signed out. */
  deletionRequestedAt: Date | null;
  /**
   * Set while an admin has the account suspended after a report (FR-46): it counts as signed out everywhere but the
   * suspension notice, unless the person is an admin (src/lib/auth/server.ts).
   */
  suspendedAt: Date | null;
  /** The admin's reason, for the notice. Never logged. */
  suspendedReason: string | null;
};

const accountColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  firstName: users.firstName,
  lastName: users.lastName,
  weeklyHours: users.weeklyHours,
  deletionRequestedAt: users.deletionRequestedAt,
  suspendedAt: users.suspendedAt,
  suspendedReason: users.suspendedReason,
};

const normalEmail = (email: string) => email.trim().toLowerCase();

/** Our user for this sign-in, or null before they finish sign-up. Includes an account waiting to be deleted. */
export async function findAccount(subject: string, db: Pick<Db, "select"> = getDb()): Promise<Account | null> {
  const [row] = await db
    .select(accountColumns)
    .from(users)
    .where(eq(users.authSubject, subject))
    .limit(1);
  return row ?? null;
}

/** How many of this browser's anonymous resumes moved to the account, and how many stayed out because of their name. */
export type ClaimResult = { claimed: number; refused: number };

/**
 * Moves this browser's anonymous analyses (FR-2) to the user: resume, gaps and path follow, since they hang off the
 * resume, and the upload consent is linked to the user too. Only unclaimed resumes within their 24 hours move, and
 * only when the name on the resume matches the account's (src/lib/resume/name-match.ts): one that shows a different
 * name stays anonymous and is deleted after its 24 hours. Once claimed, the session no longer reaches them (see
 * `ownsResume`); the session id stays only so the session's daily limits still count them. A resume still being read
 * isn't claimed, since its name isn't known yet; it stays anonymous for the next sign-in. An account with no name
 * claims nothing.
 */
export async function claimAnonymousResumes(userId: string, sessionId: string, db: Db | Tx = getDb()): Promise<ClaimResult> {
  const waiting = await db
    .select({ id: resumes.id, nameHashes: resumes.nameHashes })
    .from(resumes)
    .where(
      and(
        eq(resumes.anonymousSessionId, sessionId),
        isNull(resumes.userId),
        inArray(resumes.status, ["parsed", "partial"]),
        gt(resumes.createdAt, new Date(Date.now() - ANONYMOUS_TTL_HOURS * 3600_000)),
      ),
    );
  if (!waiting.length) return { claimed: 0, refused: 0 };
  const [account] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  if (!hasUsableName(account?.name)) return { claimed: 0, refused: 0 };
  const ids = waiting.filter((r) => checkName(account?.name, r.nameHashes) !== "mismatch").map((r) => r.id);
  const refused = waiting.length - ids.length;
  if (!ids.length) return { claimed: 0, refused };
  const claimed = await db
    .update(resumes)
    .set({ userId })
    .where(and(inArray(resumes.id, ids), isNull(resumes.userId)))
    .returning({ id: resumes.id, consentId: resumes.consentId });
  const consentIds = claimed.flatMap((r) => (r.consentId ? [r.consentId] : []));
  if (consentIds.length) await db.update(consents).set({ userId }).where(and(inArray(consents.id, consentIds), isNull(consents.userId)));
  return { claimed: claimed.length, refused };
}

/** refused: anonymous resumes left out of the account because they show a different name. */
export type CreateAccountResult = { ok: true; account: Account; refused: number } | { ok: false; reason: "email_taken" | "email_unverified" };

/**
 * Finishes sign-up after the person ticked "I am 18 or older": creates the user (or links an existing one with the
 * same verified email and no sign-in yet, for a later change of provider), records the account consent and claims
 * this browser's anonymous analyses. Safe to call twice: a second call claims and returns the same account.
 */
export async function createAccount(
  identity: Identity,
  input: { name: string | null; firstName?: string | null; lastName?: string | null; sessionId: string | null },
  db: Db = getDb(),
): Promise<CreateAccountResult> {
  const email = normalEmail(identity.email);
  return db.transaction(async (tx) => {
    // One sign-up per sign-in and per email at a time, so two tabs can't both insert. Always subject, then email.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-account-sub:${identity.subject}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-account:${email}`}))`);
    let existing = await findAccount(identity.subject, tx);
    if (existing) {
      // An account made before names were asked for gets its name here, before anything is claimed.
      if (!hasUsableName(existing.name) && hasUsableName(input.name)) {
        const names = { name: input.name, firstName: input.firstName ?? null, lastName: input.lastName ?? null };
        await tx.update(users).set(names).where(eq(users.id, existing.id));
        existing = { ...existing, ...names };
      }
      const claim = input.sessionId ? await claimAnonymousResumes(existing.id, input.sessionId, tx) : null;
      return { ok: true, account: existing, refused: claim?.refused ?? 0 } as const;
    }

    const [byEmail] = await tx
      .select({ id: users.id, authSubject: users.authSubject, deletionRequestedAt: users.deletionRequestedAt, firstName: users.firstName, name: users.name })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    // A deleted account is restored by signing in the way it was made, never taken over by linking.
    if (byEmail?.authSubject || byEmail?.deletionRequestedAt) return { ok: false, reason: "email_taken" } as const;
    // Linking hands over an existing user's data, so only a proven email may do it.
    if (byEmail && !identity.emailVerified) return { ok: false, reason: "email_unverified" } as const;

    const now = new Date();
    const values = {
      authSubject: identity.subject,
      name: input.name,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      ageConfirmedAt: now,
      lastSeenAt: now,
    };
    // A name the linked row already has stays: names are locked once set.
    const keepName = byEmail && nameLocked(byEmail);
    const update = keepName ? { email, authSubject: values.authSubject, ageConfirmedAt: now, lastSeenAt: now } : { email, ...values };
    const [row] = byEmail
      ? await tx.update(users).set(update).where(eq(users.id, byEmail.id)).returning(accountColumns)
      : await tx.insert(users).values({ email, ...values }).returning(accountColumns);
    await tx.insert(consents).values({ userId: row.id, email, purpose: "account", policyVersion: ACCOUNT_POLICY_VERSION });
    const claim = input.sessionId ? await claimAnonymousResumes(row.id, input.sessionId, tx) : null;
    return { ok: true, account: row, refused: claim?.refused ?? 0 } as const;
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

/** The longest first or last name kept. */
export const NAME_PART_MAX = 40;

/**
 * Saves first and last name and the full name made from them. The full name is what later resumes are checked
 * against, so a change applies to resumes added after it; ones already on the account stay.
 */
export async function saveNames(userId: string, first: string, last: string, db: Pick<Db, "update"> = getDb()): Promise<boolean> {
  const firstName = fullName(first, null).slice(0, NAME_PART_MAX);
  const lastName = fullName(last, null).slice(0, NAME_PART_MAX);
  if (!firstName) return false;
  const rows = await db
    .update(users)
    .set({ firstName, lastName: lastName || null, name: fullName(firstName, lastName) })
    // Only while the account has no name yet (Milin, 2026-10-12): once set it is locked, so it can't be changed to
    // match someone else's resume. Corrections go through a request to us.
    .where(and(eq(users.id, userId), isNull(users.firstName), or(isNull(users.name), sql`btrim(${users.name}) = ''`)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** True once the account has a name: from then on only we can correct it (saveNames refuses). */
export function nameLocked(account: { firstName: string | null; name: string | null } | null | undefined): boolean {
  return hasUsableName(account?.firstName) || hasUsableName(account?.name);
}
