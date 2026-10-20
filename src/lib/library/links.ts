import { SUGGESTION_URL_MAX } from "@/lib/schemas/constants";

/*
 * Links people suggest for the Library (docs/plans/library-part-2-plan.md), in plain code so the schema, the store and
 * the tests share it. The server never fetches a suggested link (no server-side request forgery); only an admin opens
 * it, from /admin/library. So the checks here are on the text of the link alone.
 */

/** Tracking and affiliate parameters, stripped before a link is stored or compared. */
const TRACKING = /^(utm_.*|ref|aff.*|tag|fbclid|gclid)$/i;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Link shorteners hide where a link goes, so an admin can't see the real site before opening it (T88, T99). The common
 * public ones; youtu.be is left out on purpose, as it only ever opens YouTube.
 */
export const SHORTENERS: readonly string[] = [
  "bit.ly",
  "bit.do",
  "tinyurl.com",
  "tiny.cc",
  "t.co",
  "t.ly",
  "goo.gl",
  "forms.gle",
  "ow.ly",
  "is.gd",
  "v.gd",
  "buff.ly",
  "rebrand.ly",
  "bl.ink",
  "short.io",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "lnkd.in",
  "s.id",
  "tr.im",
  "x.co",
  "db.tt",
  "amzn.to",
  "qr.ae",
  "adf.ly",
  "shorte.st",
  "bc.vc",
  "po.st",
  "mcaf.ee",
  "su.pr",
];

/** True for a known link shortener, or a name under one (www.bit.ly). */
export function shortenerHost(host: string): boolean {
  return SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`));
}

/** True for a host we refuse: an IP address, localhost, a name with no dot (an intranet name), or one over 253 characters. */
function badHost(host: string): boolean {
  if (!host || host.length > 253 || host.startsWith("[") || host.includes(":")) return true;
  if (IPV4.test(host) || /^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  return !host.includes(".") || host.endsWith(".");
}

/**
 * A suggested link, cleaned: https only, with no user name, password or port, and a host that is a public name (not
 * an IP address, localhost or a link shortener). Tracking and affiliate parameters and the #fragment are dropped. Null when it can't be
 * used, or is longer than 500 characters once cleaned.
 */
export function cleanSuggestedUrl(raw: string): { url: string; host: string } | null {
  const text = raw.trim();
  if (!text || text.length > 2000 || /\s/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (badHost(host) || shortenerHost(host)) return null;
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  u.hash = "";
  const url = u.toString();
  if (url.length > SUGGESTION_URL_MAX) return null;
  return { url, host };
}

/**
 * The form two links are compared in, to find a suggestion that is already in the catalog: no "www.", no trailing
 * slash, no tracking parameters or fragment, host in lower case. Null for a link that isn't a usable https link.
 */
export function linkKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const query = u.searchParams.toString();
  return `${host}${path}${query ? `?${query}` : ""}`;
}
