import { credlyBadge, type CredlyBadge, type CredlyCheckNote, type Certification } from "@/lib/schemas";
import { checkName, nameHashes } from "@/lib/resume/name-match";
import { allowedVerifyLink } from "./rules";

/**
 * The Credly badge check (pending item 13, dev/profile-certs-plan.md). Credly's public badge JSON needs no key. This
 * file has no database and no server secrets beyond the name-hash key, so the store and the tests share it; the
 * network call is `fetchCredlyBadge`, and everything else takes a fetcher so tests and local test mode never call out.
 */

/** Hosts whose badge links we read a badge id from. rules.ts has already accepted the link. */
const BADGE_LINK_HOSTS = new Set(["www.credly.com", "credly.com", "www.youracclaim.com"]);
/** The only hosts the check ever calls: Credly and its API host. */
const FETCH_HOSTS = new Set(["www.credly.com", "credly.com", "api.credly.com"]);
export const CREDLY_TIMEOUT_MS = 4000;
export const CREDLY_MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The badge id (lower case) from a Credly badge link rules.ts accepts, or null for any other link. */
export function credlyBadgeId(url: string): string | null {
  if (!allowedVerifyLink(url)) return null;
  const parsed = new URL(url);
  if (!BADGE_LINK_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const id = /^\/badges\/([^/]+)/.exec(parsed.pathname)?.[1];
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** The badge's public page, the only certificate link a profile shows. Rebuilt from the id, never the typed link. */
export const credlyBadgePage = (badgeId: string) => `https://www.credly.com/badges/${badgeId.toLowerCase()}`;

/** Whether the check may call this address: https on Credly's own hosts, with no user info or port. */
export function allowedCredlyFetch(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port && FETCH_HOSTS.has(parsed.hostname.toLowerCase());
}

/** What Credly said: the badge JSON, no such badge, a private one, or no usable answer. */
export type CredlyFetch = { kind: "ok"; body: unknown } | { kind: "not_found" } | { kind: "private" } | { kind: "unreachable" };
export type CredlyFetcher = (badgeId: string) => Promise<CredlyFetch>;

/** Reads at most `max` bytes of a body as text; null past the cap (and the rest is never pulled). */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Fetches a badge's public JSON from Credly: https only, Credly's hosts only, redirects followed by hand (at most 2,
 * each checked against the same list), no cookies or credentials, never cached, a timeout and a size cap. Never
 * throws; anything unexpected is "unreachable".
 */
export async function fetchCredlyBadge(
  badgeId: string,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<CredlyFetch> {
  if (!UUID.test(badgeId)) return { kind: "not_found" };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(Math.min(deps.timeoutMs ?? CREDLY_TIMEOUT_MS, CREDLY_TIMEOUT_MS));
  const maxBytes = Math.min(deps.maxBytes ?? CREDLY_MAX_BYTES, CREDLY_MAX_BYTES);
  let url = `https://www.credly.com/badges/${badgeId.toLowerCase()}.json`;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!allowedCredlyFetch(url)) return { kind: "unreachable" };
      const res = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" },
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!location) return { kind: "unreachable" };
        url = new URL(location, url).toString();
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel().catch(() => {});
        return { kind: "not_found" };
      }
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel().catch(() => {});
        return { kind: "private" };
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { kind: "unreachable" };
      }
      const text = await readCapped(res, maxBytes);
      if (text === null) return { kind: "unreachable" };
      try {
        return { kind: "ok", body: JSON.parse(text) };
      } catch {
        return { kind: "unreachable" };
      }
    }
    return { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

/** Lower-case words, with "&" read as "and" and punctuation dropped; "+" and "#" stay (Security+, C#). */
const words = (s: string): string[] =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Where `needle` sits as a run of whole words in `hay`, or -1. */
function runAt(hay: string[], needle: string[]): number {
  if (!needle.length || needle.length > hay.length) return -1;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return i;
  return -1;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);

/** Words a badge name may add around our certificate's name: levels and labels, never a different subject. */
const NEUTRAL = new Set(["the", "certification", "certificate", "certified", "badge", "ce", "foundational", "associate", "professional", "specialty", "expert", "level"]);

/**
 * Whether a Credly badge name is our certificate: the same as its name (with or without the bracketed exam code) or one
 * of its aliases, or its name with only neutral words, its own code or its aliases around it. "AWS Certified Cloud
 * Practitioner – Foundational" is; "AWS Certified Cloud Practitioner Essentials Learning Plan" (a course) is not.
 */
export function badgeNameMatches(badgeName: string, cert: Pick<Certification, "name" | "aliases">): boolean {
  const badge = words(badgeName);
  const full = words(cert.name);
  const base = words(cert.name.replace(/\([^)]*\)/g, " "));
  const aliases = cert.aliases.map(words);
  if ([full, base, ...aliases].some((c) => c.length && same(badge, c))) return true;
  const own = new Set([...full, ...aliases.flat()]);
  for (const name of [full, base]) {
    const at = runAt(badge, name);
    if (at < 0) continue;
    const rest = [...badge.slice(0, at), ...badge.slice(at + name.length)];
    if (rest.every((w) => NEUTRAL.has(w) || own.has(w))) return true;
  }
  return false;
}

/**
 * Whether a Credly issuer is our certificate's issuer: one of the names in ours ("CNCF / Linux Foundation", "Tableau
 * (Salesforce)") as whole words in Credly's, or the same letters ("ISC2" and "(ISC)²").
 */
export function issuerMatches(credlyIssuers: string[], ourIssuer: string): boolean {
  const ours = ourIssuer
    .split(/[/()]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^e\.g\./i.test(s))
    .map(words)
    .filter((w) => w.length);
  return credlyIssuers.some((name) => {
    const theirs = words(name);
    return ours.some((o) => runAt(theirs, o) >= 0 || theirs.join("") === o.join(""));
  });
}

/**
 * Compares a badge with the certificate the person claimed (dev/profile-certs-plan.md decision 6). Null when it
 * matches; otherwise the first reason it doesn't. Proof rules are not touched here: this only decides the label.
 */
export function compareBadge(
  badge: CredlyBadge,
  input: { cert: Pick<Certification, "name" | "aliases" | "issuer">; accountName: string | null; today: string; env?: Record<string, string | undefined> },
): CredlyCheckNote | null {
  const d = badge.data;
  if (d.state !== "accepted" || d.public === false) return "not_public";
  if (d.expires_at_date && d.expires_at_date.slice(0, 10) < input.today) return "expired";
  if (!badgeNameMatches(d.badge_template.name, input.cert)) return "badge_name";
  const issuers = [...(d.issuer?.entities ?? []), ...(d.badge_template.issuer?.entities ?? [])].map((e) => e.entity.name);
  if (!issuerMatches(issuers, input.cert.issuer)) return "issuer";
  const earner = d.issued_to?.trim() || [d.issued_to_first_name, d.issued_to_last_name].filter(Boolean).join(" ");
  const name = checkName(input.accountName, nameHashes(earner, input.env), input.env);
  if (name === "unnamed") return "no_name";
  if (name !== "match") return "earner_name";
  return null;
}

/**
 * Checks one badge: fetch, read and compare. Null when verified, else the reason. A reply we can't read counts as not
 * reached, never as verified; a reply about another badge counts as not found.
 */
export async function checkCredlyBadge(
  badgeId: string,
  input: Parameters<typeof compareBadge>[1] & { fetcher: CredlyFetcher },
): Promise<CredlyCheckNote | null> {
  const got = await input.fetcher(badgeId);
  if (got.kind === "not_found") return "not_found";
  if (got.kind === "private") return "not_public";
  if (got.kind === "unreachable") return "unreachable";
  const parsed = credlyBadge.safeParse(got.body);
  if (!parsed.success) return "unreachable";
  if (parsed.data.data.id.toLowerCase() !== badgeId.toLowerCase()) return "not_found";
  return compareBadge(parsed.data, input);
}
