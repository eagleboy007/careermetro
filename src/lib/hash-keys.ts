/**
 * Keys for the one-way hashes the app stores or compares (H7, dev/engineering-standards.md). Each kind of hash has its
 * own key, so rotating CRON_SECRET (which also authenticates the cron jobs) can't break name checks, and a leak of one
 * key doesn't expose the others. Until a key is set, the hash uses CRON_SECRET as before, so nothing changes on the day
 * the code ships; once it is set, hashes made before it still match (see nameHashKeys).
 */
type Env = Record<string, string | undefined>;

const legacy = (env: Env) => env.CRON_SECRET || "local-development-only";

/**
 * The keys for resume-name word hashes: the first makes new hashes, and every one is tried when comparing. With
 * NAME_HASH_KEY set, the old CRON_SECRET key stays in the list so names saved before the switch still match.
 */
export function nameHashKeys(env: Env = process.env): string[] {
  const old = `resume-name|${legacy(env)}`;
  return env.NAME_HASH_KEY ? [`resume-name|${env.NAME_HASH_KEY}`, old] : [old];
}

/**
 * The key for hashes of IP addresses and emails in the upload and rate-limit counters. Those rows only live for a day
 * or two, so switching keys at most resets today's counts.
 */
export function ipHashKey(env: Env = process.env): string {
  return env.IP_HASH_KEY || legacy(env);
}
