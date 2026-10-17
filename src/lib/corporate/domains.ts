/*
 * Work-email domain rules (dev/corporate-plan.md, handoff 12d and 12f). Pure, so the sign-up form, the store and the
 * tests share them. Nothing here logs or keeps an address.
 */

/**
 * Personal mail providers. A work email on one of these, or on a subdomain of one, never proves a company. Country
 * variants are listed because people in India often have the .co.in or .in address.
 */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "ymail.com",
  "rocketmail.com",
  "outlook.com",
  "outlook.in",
  "hotmail.com",
  "hotmail.co.in",
  "live.com",
  "live.in",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "rediffmail.com",
  "rediff.com",
  // Zoho Mail's personal addresses. Companies on Zoho use their own domain, which is fine.
  "zohomail.com",
  "zohomail.in",
  "zoho.com",
  "aol.com",
  "yandex.com",
  "yandex.ru",
  "ya.ru",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "mail.com",
  "yahoo.co.uk",
  "hotmail.co.uk",
  "outlook.co.in",
  "mail.ru",
  "indiatimes.com",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "duck.com",
];

/** Providers whose personal mail runs on many country domains (yahoo.fr, hotmail.de): any registered domain of theirs. */
const FREE_MAIL_NAMES = new Set(["gmail", "googlemail", "yahoo", "ymail", "hotmail", "outlook", "rediffmail", "protonmail"]);

/** Second-level labels under a country code: "example.co.in" is example's, not "co"'s. */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "ac", "edu", "gov", "gen", "firm", "ind", "res", "ltd", "plc"]);

/** The registered domain: "mail.garudasec.co.in" is "garudasec.co.in". */
export function baseDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  const keep = labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A lowercase domain name with at least two labels and a letters-only top level, or null. */
export function normalDomain(value: string): string | null {
  const d = value.trim().toLowerCase().replace(/\.$/, "");
  if (!d || d.length > 253) return null;
  const labels = d.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (!/^[a-z]{2,63}$/.test(labels.at(-1)!)) return null;
  return d;
}

/** The domain of an email address, lowercase, or null when the address doesn't look like one. */
export function emailDomain(email: string): string | null {
  const e = email.trim();
  if (e.length > 254 || /\s/.test(e)) return null;
  const at = e.lastIndexOf("@");
  if (at < 1 || at !== e.indexOf("@")) return null;
  const local = e.slice(0, at);
  if (local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  return normalDomain(e.slice(at + 1));
}

/** True when `domain` is `base` or a subdomain of it. */
export const isOnDomain = (domain: string, base: string): boolean => domain === base || domain.endsWith(`.${base}`);

/** True for a personal mail domain, or a subdomain of one. */
export const isFreeMail = (domain: string): boolean =>
  FREE_MAIL_DOMAINS.some((f) => isOnDomain(domain, f)) || FREE_MAIL_NAMES.has(baseDomain(domain).split(".")[0]!);

/**
 * The host of a company website typed with or without https://, or null when it isn't a plain https site. Plain http
 * is refused: the review link must be safe to open.
 */
export function websiteHost(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return normalDomain(url.hostname);
  } catch {
    return null;
  }
}

/** The website as stored: https, lowercase host, no trailing slash. Null when websiteHost refuses it. */
export function normalWebsite(value: string): string | null {
  const host = websiteHost(value);
  if (!host) return null;
  const v = value.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `https://${host}${path}`;
}

/** The registrable part to compare a website with an email domain: "www." and other subdomains of the email domain match. */
export function websiteMatchesDomain(website: string, domain: string): boolean {
  const host = websiteHost(website);
  return !!host && (isOnDomain(host, domain) || isOnDomain(domain, host));
}

export type WorkEmailProblem = "invalid" | "free_mail" | "wrong_domain";

/**
 * Checks an address typed as a work email. With `companyDomain`, it must be on that domain or a subdomain of it
 * (people at mail.example-labs.in belong to example-labs.in).
 */
export function checkWorkEmail(email: string, companyDomain?: string): { ok: true; domain: string } | { ok: false; problem: WorkEmailProblem } {
  const domain = emailDomain(email);
  if (!domain) return { ok: false, problem: "invalid" };
  if (isFreeMail(domain)) return { ok: false, problem: "free_mail" };
  if (companyDomain && !isOnDomain(domain, companyDomain)) return { ok: false, problem: "wrong_domain" };
  return { ok: true, domain };
}

/** What each problem tells the person. */
export function workEmailProblemText(problem: WorkEmailProblem, companyDomain?: string): string {
  if (problem === "free_mail") return "Use your work email at the company. Personal addresses like Gmail or Outlook can't confirm a company.";
  if (problem === "wrong_domain") return `Use an email ending in @${companyDomain ?? "your company's domain"}, the domain your company verified.`;
  return "Check your work email. It looks incomplete.";
}
