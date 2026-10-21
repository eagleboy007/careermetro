import { firstPerWindow, localGuard, parseCspReport, reportFormat, violationKey, type CspViolation } from "@/lib/csp-report";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/session";
import { addressKey } from "@/lib/shared-limit";

/** One report is a few KB at most, but a Reporting API batch can hold many, each with a script sample. */
const MAX_BODY_BYTES = 64 * 1024;

const HOUR = 60 * 60 * 1000;
/** Log lines an hour per server: 100 per address and about 1,000 from everyone together. */
const guard = localGuard({ perKey: 100, total: 1_000, windowMs: HOUR });
/** Each directive and blocked host is logged once an hour per server (T118): a repeat costs no line and no count. */
const seen = firstPerWindow({ windowMs: HOUR });

type DropReason = "content_type" | "too_large" | "bad_json" | "bad_shape" | "not_csp";

const done = () => new Response(null, { status: 204 });

/** The body as text, or null once it passes the cap, without reading more than the cap from the stream. */
async function readCapped(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * CSP violation reports (docs/dev/security-sweep-2026-10-20.md). Browsers send them without cookies and without an
 * Origin we can rely on, so there is no same-origin check and no session: the route reads no cookie and sets none,
 * and the proxy's matcher leaves /api/ alone. Only the two report content types are read. Each violation is logged
 * as its directive and the blocked host or keyword, the first time that pair is seen this hour (at most 100 lines per
 * address and 1,000 in all an hour, per server, with no database write), never a URL, path, query, page address, referrer, source file or
 * script sample. Always answers 204, whatever was sent, so the endpoint tells a caller nothing.
 */
export async function POST(request: Request) {
  const key = addressKey(clientIp(request));
  // One line with a fixed reason, behind the same guard, so a refused report is visible but can't flood the logs.
  const drop = (reason: DropReason) => {
    if (guard.take(key)) logEvent("info", "csp_report_dropped", { reason });
    return done();
  };
  const format = reportFormat(request.headers.get("content-type"));
  if (!format) return drop("content_type");
  const text = await readCapped(request);
  if (text === null) return drop("too_large");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return drop("bad_json");
  }
  const violations = parseCspReport(format, json);
  if (!violations) return drop("bad_shape");
  if (violations.length === 0) return drop("not_csp");

  // Only the first of each directive and host this hour, and once per request.
  const fresh = new Map<string, CspViolation>();
  for (const v of violations) if (!seen.has(violationKey(v))) fresh.set(violationKey(v), v);
  if (fresh.size === 0) return done();
  if (!guard.take(key, fresh.size)) return done();
  for (const [pair, v] of fresh) {
    seen.add(pair);
    logEvent("warn", "csp_violation", { directive: v.directive, blocked: v.blocked });
  }
  return done();
}
