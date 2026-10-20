import { localGuard, parseCspReport, reportFormat } from "@/lib/csp-report";
import { logEvent } from "@/lib/log";
import { clientIp } from "@/lib/session";
import { addressKey, LIMITS, takeShared } from "@/lib/shared-limit";

/** A real report is well under 4 KB; a Reporting API batch of a few is still far below this. */
const MAX_BODY_BYTES = 16 * 1024;

const guard = localGuard(LIMITS.cspReportsPerIp.max, LIMITS.cspReportsPerIp.windowMs);

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
 * as its directive and the blocked host or keyword, never a URL, path, query, page address, referrer, source file or
 * script sample. Always answers 204, whatever was sent, so the endpoint tells a caller nothing.
 */
export async function POST(request: Request) {
  const format = reportFormat(request.headers.get("content-type"));
  if (!format) return done();
  const text = await readCapped(request);
  if (text === null) return done();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    return done();
  }
  const violations = parseCspReport(format, json);
  if (!violations || violations.length === 0) return done();

  const key = addressKey(clientIp(request));
  if (!guard.take(key) || !(await takeShared(LIMITS.cspReportsPerIp, key))) return done();

  for (const v of violations) logEvent("warn", "csp_violation", { directive: v.directive, blocked: v.blocked });
  return done();
}
