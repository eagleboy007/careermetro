import "server-only";
import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { blocks, consents, userPay, userSettings, usernameRedirects, users } from "@/db/schema";
import { currentAnalysis } from "@/lib/gaps/current";
import { DEFAULT_SETTINGS, type SettingsField, type SettingsInput, type UserSettings } from "@/lib/schemas";
import { FIND_CONSENT_PURPOSE, FIND_POLICY_VERSION, USERNAME_CHANGE_DAYS, USERNAME_REDIRECT_DAYS } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { normalUsername, USERNAME_MESSAGES, usernameProblem } from "./username";

type Db = ReturnType<typeof getDb>;

/**
 * Account settings, part 2 (dev/account-settings-plan.md): username and profile link, headline, private pay, privacy
 * and stored-only notification choices. Nothing here logs a username, headline or pay; errors that reach the logs go
 * through the scrubber, which drops query parameters.
 */

const DAY = 24 * 3600_000;

export type Pay = { currentLakh: number | null; expectedLakh: number | null };

export type AccountSettings = {
  username: string | null;
  /** When the username can next change; null when it can change now (or none is set yet). */
  usernameLockedUntil: Date | null;
  headline: string | null;
  settings: UserSettings;
  pay: Pay;
};

const settingsColumns = {
  visibility: userSettings.profileVisibility,
  showTargetRole: userSettings.showTargetRole,
  showExperience: userSettings.showExperience,
  showEducation: userSettings.showEducation,
  showSkills: userSettings.showSkills,
  showGaps: userSettings.showGaps,
  showCertifications: userSettings.showCertifications,
  companiesCanFind: userSettings.companiesCanFind,
  rideReminder: userSettings.rideReminder,
  emailCompanyMessages: userSettings.emailCompanyMessages,
  emailWeeklySummary: userSettings.emailWeeklySummary,
};

/** The person's privacy and notification choices; DEFAULT_SETTINGS until they save some. */
export async function settingsFor(userId: string, db: Pick<Db, "select"> = getDb()): Promise<UserSettings> {
  const [row] = await db.select(settingsColumns).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row ?? DEFAULT_SETTINGS;
}

const lockedUntil = (changedAt: Date | null, now: Date): Date | null => {
  if (!changedAt) return null;
  const until = new Date(changedAt.getTime() + USERNAME_CHANGE_DAYS * DAY);
  return until > now ? until : null;
};

/** Everything the settings page shows for part 2. Pay is read here for its owner only. */
export async function readAccountSettings(userId: string, now: Date, db: Db = getDb()): Promise<AccountSettings | null> {
  const [[user], settings, [pay]] = await Promise.all([
    db.select({ username: users.username, changedAt: users.usernameChangedAt, headline: users.headline }).from(users).where(eq(users.id, userId)).limit(1),
    settingsFor(userId, db),
    db.select({ currentLakh: userPay.currentLakh, expectedLakh: userPay.expectedLakh }).from(userPay).where(eq(userPay.userId, userId)).limit(1),
  ]);
  if (!user) return null;
  return {
    username: user.username,
    usernameLockedUntil: user.username ? lockedUntil(user.changedAt, now) : null,
    headline: user.headline,
    settings,
    pay: pay ?? { currentLakh: null, expectedLakh: null },
  };
}

/** Someone else holds this username, or held it within the last USERNAME_REDIRECT_DAYS (it still redirects to them). */
async function heldByOther(name: string, userId: string, now: Date, db: Pick<Db, "select"> | Tx): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.username}) = ${name}`, ne(users.id, userId)))
    .limit(1);
  if (user) return true;
  const [old] = await db
    .select({ id: usernameRedirects.userId })
    .from(usernameRedirects)
    .where(and(eq(usernameRedirects.username, name), gt(usernameRedirects.expiresAt, now), ne(usernameRedirects.userId, userId)))
    .limit(1);
  return !!old;
}

export type UsernameCheck =
  | { state: "available" | "yours" | "taken" | "limited" }
  | { state: "invalid"; message: string };

/** "Is this username free?" while the person types. Counted against a shared limit, so usernames can't be listed by script. */
export async function checkUsername(userId: string, raw: string, now: Date, db: Db = getDb()): Promise<UsernameCheck> {
  const name = normalUsername(raw.slice(0, 60));
  const problem = usernameProblem(name);
  if (problem) return { state: "invalid", message: USERNAME_MESSAGES[problem] };
  if (!(await takeShared(LIMITS.usernameChecksPerUser, userId, { now: now.getTime() }))) return { state: "limited" };
  const [me] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
  if (me?.username === name) return { state: "yours" };
  return (await heldByOther(name, userId, now, db)) ? { state: "taken" } : { state: "available" };
}

export type SaveResult = { ok: true } | { ok: false; errors: Partial<Record<SettingsField, string>> };

const TAKEN = "Taken. Try another.";
const dateText = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Saves one settings form in one transaction: nothing is saved if any part is refused. A new username waits 30 days
 * after the last one (the first is free), counts against a daily limit of tries, and can't be one someone else holds or
 * held in the last 14 days. The old one then redirects here for 14 days. Pay with both values empty is deleted.
 */
export async function saveAccountSettings(userId: string, input: SettingsInput, now: Date, db: Db = getDb()): Promise<SaveResult> {
  const fail = (errors: Partial<Record<SettingsField, string>>): SaveResult => ({ ok: false, errors });
  try {
    return await db.transaction(async (tx) => {
      const [me] = await tx
        .select({ username: users.username, changedAt: users.usernameChangedAt, deletionRequestedAt: users.deletionRequestedAt })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!me || me.deletionRequestedAt) return fail({ settings: "Please sign in again to save changes." });

      const changes: Partial<typeof users.$inferInsert> = { headline: input.headline };
      const name = input.username;
      if (name && name !== me.username) {
        const until = me.username ? lockedUntil(me.changedAt, now) : null;
        if (until) return fail({ username: `You can change your username again on ${dateText(until)}.` });
        if (!(await takeShared(LIMITS.usernameSavesPerUser, userId, { db: tx, now: now.getTime() })))
          return fail({ username: "Too many tries today. Please try again tomorrow." });
        // One claim of a name at a time, so two people saving it together can't both pass the check below.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-username:${name}`}))`);
        if (await heldByOther(name, userId, now, tx)) return fail({ username: TAKEN });
        // Taking back your own old name, or one whose 14 days are over, ends its redirect.
        await tx.delete(usernameRedirects).where(eq(usernameRedirects.username, name));
        if (me.username) {
          const expiresAt = new Date(now.getTime() + USERNAME_REDIRECT_DAYS * DAY);
          await tx
            .insert(usernameRedirects)
            .values({ username: me.username, userId, expiresAt, createdAt: now })
            .onConflictDoUpdate({ target: usernameRedirects.username, set: { userId, expiresAt } });
        }
        Object.assign(changes, { username: name, usernameChangedAt: now });
      }
      await tx.update(users).set(changes).where(eq(users.id, userId));

      if (input.currentPay === null && input.expectedPay === null) await tx.delete(userPay).where(eq(userPay.userId, userId));
      else {
        const pay = { currentLakh: input.currentPay, expectedLakh: input.expectedPay, updatedAt: now };
        await tx.insert(userPay).values({ userId, ...pay }).onConflictDoUpdate({ target: userPay.userId, set: pay });
      }

      const { visibility, ...rest } = input.settings;
      // "Let companies find me" (pending item 19): turning it on records a consent, turning it off withdraws it.
      // Read under a row lock (the users row above already serialises this person's saves), so two saves at once can't
      // both see the switch off and record two consents, or both see it on and withdraw none.
      const [was] = await tx.select({ on: userSettings.companiesCanFind }).from(userSettings).where(eq(userSettings.userId, userId)).for("update");
      const wasOn = was?.on ?? false;
      if (rest.companiesCanFind && !wasOn)
        await tx.insert(consents).values({ userId, purpose: FIND_CONSENT_PURPOSE, policyVersion: FIND_POLICY_VERSION, givenAt: now });
      if (!rest.companiesCanFind && wasOn)
        await tx
          .update(consents)
          .set({ withdrawnAt: now })
          .where(and(eq(consents.userId, userId), eq(consents.purpose, FIND_CONSENT_PURPOSE), isNull(consents.withdrawnAt)));
      const row = { profileVisibility: visibility, ...rest, updatedAt: now };
      await tx.insert(userSettings).values({ userId, ...row }).onConflictDoUpdate({ target: userSettings.userId, set: row });
      return { ok: true } as const;
    });
  } catch (error) {
    // 23505: someone took the name between the check and the save (the unique index on lower(username)).
    if ((error as { cause?: { code?: string } })?.cause?.code === "23505") return fail({ username: TAKEN });
    throw error;
  }
}

export type ProfileOwner = { id: string; username: string; headline: string | null; settings: UserSettings };

/**
 * Whose profile /u/<username> is: the person holding it now, or the person who gave it up within the last 14 days.
 * `redirectTo` is set when the address isn't the canonical one (an old username, or other letter case). The caller must
 * check canViewProfile before following it: a redirect names the new username and would show the profile exists.
 * Accounts waiting out their deletion have no profile.
 */
export async function findProfile(raw: string, now: Date, db: Db = getDb()): Promise<{ owner: ProfileOwner; redirectTo?: string } | null> {
  const name = normalUsername(raw.slice(0, 60));
  // A name that could never have been saved needs no query.
  if (usernameProblem(name)) return null;
  const ownerColumns = { id: users.id, username: users.username, headline: users.headline, deletionRequestedAt: users.deletionRequestedAt, suspendedAt: users.suspendedAt };
  let [user] = await db.select(ownerColumns).from(users).where(sql`lower(${users.username}) = ${name}`).limit(1);
  if (!user) {
    [user] = await db
      .select(ownerColumns)
      .from(usernameRedirects)
      .innerJoin(users, eq(users.id, usernameRedirects.userId))
      .where(and(eq(usernameRedirects.username, name), gt(usernameRedirects.expiresAt, now)))
      .limit(1);
  }
  // A suspended account's profile (FR-46) reads as not there, like a deleted one, until the suspension is lifted.
  if (!user?.username || user.deletionRequestedAt || user.suspendedAt) return null;
  const owner = { id: user.id, username: user.username, headline: user.headline, settings: await settingsFor(user.id, db) };
  return raw === user.username ? { owner } : { owner, redirectTo: user.username };
}

export type ProfileAnswer = { kind: "not_found" } | { kind: "redirect"; to: string } | { kind: "show"; owner: ProfileOwner };

/**
 * What /u/<username> answers a signed-in viewer. Visibility is checked before any redirect, so a hidden profile, one
 * whose owner blocked the viewer and a username nobody has all answer the same not-found, whatever spelling or old
 * username was used.
 */
export async function resolveProfile(raw: string, viewerId: string, now: Date, db: Db = getDb()): Promise<ProfileAnswer> {
  const found = await findProfile(raw, now, db);
  if (!found || !(await canViewProfile(found.owner, viewerId, db))) return { kind: "not_found" };
  return found.redirectTo ? { kind: "redirect", to: found.redirectTo } : { kind: "show", owner: found.owner };
}

/** Old usernames whose 14 days are over, for the daily clean-up. Reads already ignore them; this deletes them. */
export async function clearExpiredUsernameRedirects(db: Db = getDb(), now = new Date()): Promise<number> {
  const gone = await db.delete(usernameRedirects).where(lt(usernameRedirects.expiresAt, now)).returning({ username: usernameRedirects.username });
  return gone.length;
}

/**
 * Whether a signed-in viewer may see the owner's profile: always their own; never when the owner chose Only you or
 * blocked them; for People on your line, only when both aim at the same role.
 */
export async function canViewProfile(owner: Pick<ProfileOwner, "id" | "settings">, viewerId: string, db: Db = getDb()): Promise<boolean> {
  if (owner.id === viewerId) return true;
  if (owner.settings.visibility === "only_me") return false;
  const [blocked] = await db
    .select({ at: blocks.createdAt })
    .from(blocks)
    .where(and(eq(blocks.blockerId, owner.id), eq(blocks.blockedId, viewerId)))
    .limit(1);
  if (blocked) return false;
  if (owner.settings.visibility === "signed_in") return true;
  const [theirs, mine] = await Promise.all([currentAnalysis(owner.id, db), currentAnalysis(viewerId, db)]);
  return !!theirs && !!mine && theirs.result.roleSlug === mine.result.roleSlug;
}

/** For "Download your data": the settings, pay and old usernames, as stored. */
export async function exportSettings(userId: string, db: Db = getDb()) {
  const [settings, [pay], oldUsernames] = await Promise.all([
    db.select({ ...settingsColumns, updatedAt: userSettings.updatedAt }).from(userSettings).where(eq(userSettings.userId, userId)),
    db.select({ currentLakh: userPay.currentLakh, expectedLakh: userPay.expectedLakh, updatedAt: userPay.updatedAt }).from(userPay).where(eq(userPay.userId, userId)),
    db.select({ username: usernameRedirects.username, redirectsUntil: usernameRedirects.expiresAt }).from(usernameRedirects).where(eq(usernameRedirects.userId, userId)),
  ]);
  return {
    // No saved choices yet means the defaults apply; the download says which.
    settings: settings[0] ?? { ...DEFAULT_SETTINGS, savedAt: null },
    pay: pay ?? null,
    oldUsernames,
  };
}
