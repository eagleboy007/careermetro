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

/**
 * The key for certificate credential-id hashes (gap_proofs.credential_key, dev/proof-plan.md rule 3). It must stay
 * fixed: the one-account-per-certificate check compares new hashes with stored ones, so it follows NAME_HASH_KEY,
 * which is never rotated either.
 */
export function credentialHashKey(env: Env = process.env): string {
  return `credential|${env.NAME_HASH_KEY || legacy(env)}`;
}

/**
 * The key for hashes of pasted job postings (job_checks.text_hash), which only spot the same text sent twice for one
 * resume. A new key at most means one more model call for a posting already checked, so it follows NAME_HASH_KEY.
 */
export function jobTextHashKey(env: Env = process.env): string {
  return `jobText|${env.NAME_HASH_KEY || legacy(env)}`;
}

/**
 * The key for work-email hashes (dev/corporate-plan.md): the 6-digit codes and the invited work emails. An invite is
 * found again by the hash of the email the colleague types, days later, so the key must stay fixed: it follows
 * NAME_HASH_KEY, which is never rotated. Codes live 10 minutes, so they could take any key; one key keeps it simple.
 */
export function workEmailHashKey(env: Env = process.env): string {
  return `work-email|${env.NAME_HASH_KEY || legacy(env)}`;
}

/**
 * The secret a phone number shared for an interview is encrypted with (applications.phone_shared, corporate build
 * step 6). Unlike the others it is not a hash: the interview's team must read the number back, so a guessable key
 * would expose every number. PHONE_KEY if set, else NAME_HASH_KEY (never rotated, so numbers saved earlier still
 * read). In production there is no fallback: without either key it is null and phone sharing is off. Elsewhere
 * (local, tests, previews) it falls back as the other keys do.
 */
export function phoneKeySecret(env: Env = process.env): string | null {
  const key = env.PHONE_KEY || env.NAME_HASH_KEY;
  if (key) return `phone|${key}`;
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return null;
  return `phone|${legacy(env)}`;
}

/**
 * The secret that seals a person's id into the opaque, per-company ref a company sees in search results (pending item
 * 19, dev/companies-find-me-plan.md). A guessable key would let a company read internal ids back, so in production there
 * is no built-in fallback: FIND_REF_KEY, else NAME_HASH_KEY, else CRON_SECRET; with none, search is off. Elsewhere
 * (local, tests, previews) it falls back as the other keys do. Rotating it only changes refs, which live one page.
 */
export function findRefSecret(env: Env = process.env): string | null {
  const key = env.FIND_REF_KEY || env.NAME_HASH_KEY || env.CRON_SECRET;
  if (key) return `find-ref|${key}`;
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") return null;
  return `find-ref|${legacy(env)}`;
}
