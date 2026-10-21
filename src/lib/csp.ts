// The Content-Security-Policy CareerMetro sends: the enforced one from next.config.ts headers(), the report-only one
// per request from src/proxy.ts (T118). Kept free of `@/` imports and server-only code so the config can import it.
// See docs/dev/security-sweep-2026-10-20.md, "script-src CSP".

/** Where browsers send violation reports (src/app/api/csp-report/route.ts). */
export const CSP_REPORT_PATH = "/api/csp-report";
/** The Reporting-Endpoints group the policy's report-to names. */
export const CSP_REPORT_GROUP = "csp-endpoint";

/** Enforced today (T25): no framing, no <base> or plugin tricks. Unchanged by the report-only policy. */
export const ENFORCED_CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

/**
 * The Vercel Toolbar, which Vercel injects on preview deployments only (vercel.com/docs/vercel-toolbar). Production
 * never loads it, so its hosts are added only off production, where they would otherwise fill the reports.
 */
const VERCEL_TOOLBAR = {
  "script-src": ["https://vercel.live"],
  "style-src": ["https://vercel.live"],
  "img-src": ["https://vercel.live", "https://vercel.com"],
  "font-src": ["https://vercel.live", "https://assets.vercel.com"],
  "connect-src": ["https://vercel.live", "wss://ws-us3.pusher.com"],
  "frame-src": ["https://vercel.live"],
} as const;

export type CspOptions = {
  /** Allow the Vercel Toolbar's hosts: true on preview deployments. */
  vercelToolbar?: boolean;
  /** `next dev` evaluates code for Fast Refresh and the error overlay, so development adds 'unsafe-eval'. */
  development?: boolean;
};

/**
 * The host allow-list policy (sweep option C), sent as Content-Security-Policy-Report-Only until a few days of
 * reports show only known, fixed violations. Every script, style, font and fetch is served from our own origin:
 * next/font self-hosts the Google fonts, Supabase is reached from the server only, and there is no analytics or
 * third-party script. 'unsafe-inline' stays for Next's inline bootstrap and RSC payload scripts, which a static,
 * cached shell can't carry a nonce for. No form-action: the Google sign-in form is redirected off-site.
 */
export function cspReportOnly(options: CspOptions = {}): string {
  const toolbar = (name: keyof typeof VERCEL_TOOLBAR) => (options.vercelToolbar ? VERCEL_TOOLBAR[name] : []);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(options.development ? ["'unsafe-eval'"] : []), ...toolbar("script-src")]],
    ["style-src", ["'self'", "'unsafe-inline'", ...toolbar("style-src")]],
    ["img-src", ["'self'", "data:", "blob:", ...toolbar("img-src")]],
    ["font-src", ["'self'", ...toolbar("font-src")]],
    ["connect-src", ["'self'", ...toolbar("connect-src")]],
    ["media-src", ["'self'"]],
    ["frame-src", options.vercelToolbar ? [...toolbar("frame-src")] : ["'none'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", [CSP_REPORT_GROUP]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * Whether a request may get the Vercel Toolbar's hosts (T118). Decided per request in src/proxy.ts, not at build time:
 * next.config.ts headers are fixed when the build runs, so a preview build later promoted to production kept the
 * preview policy. Three runtime checks, all of which a promoted deployment answers correctly:
 * - VERCEL_ENV, read when the request comes, not when the build ran: only "preview" gets the hosts.
 * - The request's host: never on the project's production domain (VERCEL_PROJECT_PRODUCTION_URL, such as
 *   careermetro.vercel.app), whatever the deployment's own VERCEL_ENV says, so a promoted build serving production
 *   traffic never gets them even if it still carries its preview environment.
 * - VERCEL_TARGET_ENV: "production" on every production alias, not only the one VERCEL_PROJECT_PRODUCTION_URL names (T119).
 */
export function vercelToolbarAllowed(host: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV === "production") return false;
  const production = (env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim().toLowerCase();
  return !production || host.trim().toLowerCase() !== production;
}

/** The Reporting-Endpoints header that names the report-to group. */
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
