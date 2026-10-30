// Removes the synthetic "Max Data" member and their synthetic peers (T150), with everything that goes with an account.
// Shared by the seed (which starts from nothing, so it can run twice) and e2e/oversize.mjs (which cleans up at the end,
// after a failure too). Local test databases only: it refuses any other host, so it can never reach staging or production.

/** The member's stored email: the test sign-in adds ".test" to the typed max-data@example.com. */
export const MAX_DATA_EMAIL = "max-data@example.com.test";
/** The peers' emails: max-data-peer-<n>@example.com.test. No "_" or "%" inside, so LIKE matches only these. */
export const PEER_EMAIL_LIKE = "max-data-peer-%@example.com.test";
export const peerEmail = (n) => `max-data-peer-${String(n).padStart(3, "0")}@example.com.test`;

/** Throws unless the database is on this machine (the CI e2e job's own Postgres, or a local one). */
export function assertLocalDatabase(url) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("the max-data seed only runs against a local database");
  if (process.env.VERCEL_ENV === "production") throw new Error("the max-data seed never runs in production");
}

/**
 * Deletes the member and the peers. Their chats go first: a chat's started_by is only set null when its starter goes, so
 * the chats themselves would stay behind. Everything else goes with the account (on delete cascade). `sql` is a
 * postgres.js client. Returns how many accounts were removed.
 */
export async function cleanMaxData(sql) {
  return sql.begin(async (tx) => {
    const ids = (await tx`select id from users where email = ${MAX_DATA_EMAIL} or email like ${PEER_EMAIL_LIKE}`).map((r) => r.id);
    if (!ids.length) return 0;
    await tx`delete from conversations where id in (select conversation_id from conversation_members where user_id in ${tx(ids)})`;
    await tx`delete from users where id in ${tx(ids)}`;
    return ids.length;
  });
}
