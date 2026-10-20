import { cspLegacyReport, cspViolationBody, reportingApiBatch } from "@/lib/schemas";

/** What one violation report is reduced to before it is logged: a directive name and a host or keyword, nothing else. */
export type CspViolation = { directive: string; blocked: string };

/** The two formats browsers send. Anything else is refused. */
export type CspReportFormat = "legacy" | "reporting-api";

/** At most this many violations are logged from one request, so one batch can't flood the logs. */
export const MAX_VIOLATIONS_PER_REQUEST = 10;

/** The format a request's content type names, or null for any other content type. Parameters such as charset are ignored. */
export function reportFormat(contentType: string | null): CspReportFormat | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/csp-report") return "legacy";
  if (type === "application/reports+json") return "reporting-api";
  return null;
}

// What browsers put in blocked-uri / blockedURL instead of a URL. Older browsers also send a bare scheme ("data").
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "data", "blob", "self", "trusted-types-policy", "trusted-types-sink"]);
const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;
const SCHEME = /^[a-z][a-z0-9+.-]{0,30}$/;
const HOST = /^[a-z0-9.-]{1,120}$/;

/** A directive name such as script-src-elem. Older browsers send the whole directive with its sources; only the name is kept. */
export function directiveName(value: string | null | undefined): string {
  const name = (value ?? "").trim().split(/\s+/)[0].toLowerCase();
  return DIRECTIVE.test(name) ? name : "unknown";
}

/**
 * The hostname of a blocked URL, or the keyword or scheme the browser sent ("inline", "eval", "data", "blob",
 * "chrome-extension"). Never the path, query, port or credentials: a URL can carry a token or a person's details.
 */
export function blockedHost(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return "none";
  if (KEYWORDS.has(v)) return v;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return "unknown";
  }
  const scheme = url.protocol.replace(/:$/, "");
  if (["http", "https", "ws", "wss"].includes(scheme)) return HOST.test(url.hostname) ? url.hostname : "unknown";
  return SCHEME.test(scheme) ? scheme : "unknown";
}

/**
 * The violations in a parsed JSON body, reduced to directive and host. Null when the body isn't a valid report of
 * the format its content type named; an empty list when a Reporting API batch held no csp-violation entries.
 */
export function parseCspReport(format: CspReportFormat, json: unknown): CspViolation[] | null {
  if (format === "legacy") {
    const parsed = cspLegacyReport.safeParse(json);
    if (!parsed.success) return null;
    const r = parsed.data["csp-report"];
    return [{ directive: directiveName(r["effective-directive"] ?? r["violated-directive"]), blocked: blockedHost(r["blocked-uri"]) }];
  }
  const batch = reportingApiBatch.safeParse(json);
  if (!batch.success) return null;
  const out: CspViolation[] = [];
  for (const entry of batch.data) {
    if (entry.type !== "csp-violation") continue;
    const body = cspViolationBody.safeParse(entry.body);
    if (!body.success) continue;
    out.push({ directive: directiveName(body.data.effectiveDirective), blocked: blockedHost(body.data.blockedURL) });
    if (out.length >= MAX_VIOLATIONS_PER_REQUEST) break;
  }
  return out;
}

export type GuardOptions = {
  /** Log lines one address may cause in a window. */
  perKey: number;
  /** Log lines this server writes in a window, from everyone together. */
  total: number;
  windowMs: number;
  /** Addresses remembered at once; past this the oldest is forgotten first. */
  maxKeys?: number;
};

/**
 * The only limit on the report endpoint, and per server: it guards log volume, nothing else, so it costs no database
 * write (a write per public report would be the cheapest way to make the app write to the database). Counts log
 * lines per address and in total in fixed windows. When more addresses are seen than it remembers, the oldest are
 * evicted, never the whole map, so a flood of new addresses can't reset everyone else's count.
 */
export function localGuard({ perKey, total, windowMs, maxKeys = 10_000 }: GuardOptions) {
  let windowStart = 0;
  let lines = 0;
  const counts = new Map<string, number>();
  return {
    /** Counts `n` lines for `key` and says whether they may be written; refused lines aren't counted. */
    take(key: string, n = 1, now = Date.now()): boolean {
      const start = Math.floor(now / windowMs) * windowMs;
      if (start !== windowStart) {
        windowStart = start;
        lines = 0;
        counts.clear();
      }
      const used = counts.get(key) ?? 0;
      if (lines + n > total || used + n > perKey) return false;
      // Re-inserting moves the key to the end, so the first key is always the one seen longest ago.
      counts.delete(key);
      while (counts.size >= maxKeys) counts.delete(counts.keys().next().value!);
      counts.set(key, used + n);
      lines += n;
      return true;
    },
  };
}
