import type { CertificateRefusal, CertificateSubmission, Certification } from "@/lib/schemas";
import { checkName, nameHashes } from "@/lib/resume/name-match";

/**
 * Pages a certificate link may point at (dev/proof-plan.md, "Checking a link"): badge platforms and issuers' own
 * verify pages, each an exact host plus the path its verify pages live under. No subdomain wildcard and no other
 * path on the same site, because many issuer sites also host forums, wikis or pages anyone can publish, and a proof
 * must not point at a page the person made. Generic Accredible hosts are left out for the same reason: anyone can
 * issue a credential there. Issuers whose verify pages we haven't confirmed are left out until we have; their
 * certificates can still be added with the file once upload ships.
 */
/** Credly's badge pages: only a badge id (a UUID) as the first part of the path, so every Credly link can be checked. */
const CREDLY_BADGE_PATH = /^\/badges\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/|$)/i;
/** Hosts whose links are Credly badges, read with credlyBadgeId (./credly.ts). */
export const BADGE_LINK_HOSTS = new Set(["www.credly.com", "credly.com", "www.youracclaim.com"]);

export const VERIFY_LINKS: { host: string; path: RegExp }[] = [
  { host: "www.credly.com", path: CREDLY_BADGE_PATH },
  { host: "credly.com", path: CREDLY_BADGE_PATH },
  { host: "www.youracclaim.com", path: CREDLY_BADGE_PATH },
  { host: "learn.microsoft.com", path: /^\/api\/credentials\/share\// },
  { host: "learn.microsoft.com", path: /^\/[a-z]{2}-[a-z]{2}\/users\/[\w.-]+\/credentials\/[\w-]+/ },
  { host: "cp.certmetrics.com", path: /^\/[a-z0-9]+\/[a-z]{2}\/public\/verify\/credential\// },
  { host: "www.coursera.org", path: /^\/(verify|account\/accomplishments\/(verify|certificate|specialization))\// },
  { host: "coursera.org", path: /^\/(verify|account\/accomplishments\/(verify|certificate|specialization))\// },
  { host: "google.accredible.com", path: /^\/[\w-]+/ },
  { host: "credentials.offsec.com", path: /^\/[\w-]+/ },
  { host: "credentials.databricks.com", path: /^\/[\w-]+/ },
  { host: "www.giac.org", path: /^\/certified-professional\// },
  { host: "rhtapps.redhat.com", path: /^\/verify/ },
  { host: "catalog-education.oracle.com", path: /^\/pls\/certview\/sharebadge/ },
  { host: "www.scrum.org", path: /^\/certificates\/\d+/ },
  { host: "verify.openedg.org", path: /^\// },
  { host: "aspen.eccouncil.org", path: /^\/verify/i },
];

/** Whether a link is https on one of VERIFY_LINKS, on that exact host and under its verify path. */
export function allowedVerifyLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  const host = parsed.hostname.toLowerCase();
  return VERIFY_LINKS.some((l) => l.host === host && l.path.test(parsed.pathname));
}

/** A link on a Credly badge host whose path doesn't start with a badge id (credlyBadgeId would read none). */
export function credlyLinkWithoutBadge(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return BADGE_LINK_HOSTS.has(parsed.hostname.toLowerCase()) && !CREDLY_BADGE_PATH.test(parsed.pathname);
}

/**
 * The honesty rules a certificate must pass before it is stored (dev/proof-plan.md rules 2 and 4, plus the form's own
 * checks). Plain code, no database: the credential-reuse rule (3) needs other accounts and lives in the store.
 * `fillingSkills` are the skills whose proof fills the goal: its own, or each skill of its "one of these" group.
 */
export function checkCertificate(input: {
  submission: Pick<CertificateSubmission, "issuedOn" | "expiresOn" | "nameOnCertificate" | "url">;
  cert: Certification | undefined;
  fillingSkills: string[];
  accountName: string | null;
  /** Today in India, YYYY-MM-DD. */
  today: string;
  env?: Record<string, string | undefined>;
}): { ok: true; skillId: string } | { ok: false; reason: CertificateRefusal } {
  const { submission, cert } = input;
  if (!cert) return { ok: false, reason: "unknown_cert" };
  // Only skills the certificate fully shows count; a skill it only touches ("partial") never fills a goal.
  const skillId = cert.proves.find((s) => input.fillingSkills.includes(s));
  if (!skillId) return { ok: false, reason: "not_covered" };
  if (submission.issuedOn > input.today) return { ok: false, reason: "issued_in_future" };
  if (submission.expiresOn && submission.expiresOn < input.today) return { ok: false, reason: "expired" };
  if (!allowedVerifyLink(submission.url)) return { ok: false, reason: "link" };
  // A Credly link must name its badge, or it could never be checked and would skip the check (review B1).
  if (credlyLinkWithoutBadge(submission.url)) return { ok: false, reason: "link" };
  const name = checkName(input.accountName, nameHashes(submission.nameOnCertificate, input.env), input.env);
  if (name === "unnamed") return { ok: false, reason: "no_name" };
  if (name !== "match") return { ok: false, reason: "name" };
  return { ok: true, skillId };
}
