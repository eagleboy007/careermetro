import { z } from "zod";

// Browsers' CSP violation reports (POST /api/csp-report). Only the two fields the endpoint logs are read; zod drops
// the rest (document-uri, referrer, source-file, script-sample and so on), so they can't reach a log by accident.

const directive = z.string().max(4096).nullish();
const blocked = z.string().max(4096).nullish();

/** The older format, `application/csp-report`: one violation, `{ "csp-report": { ... } }`. */
export const cspLegacyReport = z.object({
  "csp-report": z.object({
    "effective-directive": directive,
    "violated-directive": directive,
    "blocked-uri": blocked,
  }),
});
export type CspLegacyReport = z.infer<typeof cspLegacyReport>;

/** The body of a `csp-violation` report in the Reporting API format. */
export const cspViolationBody = z.object({
  effectiveDirective: directive,
  blockedURL: blocked,
});

/**
 * The Reporting API format, `application/reports+json`: a batch of reports of any type. Entries of other types
 * (deprecation, intervention) are skipped by the parser, not refused here.
 */
export const reportingApiBatch = z.array(z.object({ type: z.string().max(64), body: z.unknown() })).min(1).max(50);
export type ReportingApiBatch = z.infer<typeof reportingApiBatch>;
