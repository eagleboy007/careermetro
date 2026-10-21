import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The CSP report endpoint: both report formats, directive and host only in the logs, always 204, no session and no
// database write (the database mock throws).
const m = vi.hoisted(() => ({
  cookies: vi.fn(async () => {
    throw new Error("the report endpoint must not read or set cookies");
  }),
}));
vi.mock("next/headers", () => ({ cookies: m.cookies, headers: async () => new Headers() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => null }));
vi.mock("@/db", () => ({
  getDb: () => {
    throw new Error("database must not be touched");
  },
}));

import { POST } from "@/app/api/csp-report/route";
import { blockedHost, directiveName, firstPerWindow, localGuard, parseCspReport, reportFormat } from "@/lib/csp-report";
import { cspReportOnly, ENFORCED_CSP, REPORTING_ENDPOINTS } from "@/lib/csp";
import nextConfig from "../../../../next.config";

const SITE = "https://careermetro.test";
// Everything a real report carries that must never be logged.
const SECRET_BITS = ["/today", "token=abc123", "evil.example/x.js", "careermetro.test/u/", "document", "referrer", "sample", "alert(1)", "?", "#frag"];

const legacy = {
  "csp-report": {
    "document-uri": `${SITE}/u/priya-sharma?tab=resume`,
    referrer: `${SITE}/today?from=email&token=abc123`,
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'",
    disposition: "report",
    "blocked-uri": "https://cdn.evil.example:8443/x.js?token=abc123#frag",
    "line-number": 3,
    "source-file": `${SITE}/_next/static/chunks/app.js`,
    "status-code": 200,
    "script-sample": "alert(1)",
  },
};
const reportingApi = [
  {
    type: "csp-violation",
    age: 10,
    url: `${SITE}/today?token=abc123`,
    user_agent: "Mozilla/5.0",
    body: {
      documentURL: `${SITE}/today?token=abc123`,
      referrer: `${SITE}/u/priya-sharma`,
      blockedURL: "inline",
      effectiveDirective: "script-src-elem",
      originalPolicy: "default-src 'self'",
      sourceFile: `${SITE}/_next/static/chunks/app.js`,
      sample: "alert(1)",
      disposition: "report",
      statusCode: 200,
      lineNumber: 1,
      columnNumber: 2,
    },
  },
  { type: "deprecation", age: 1, url: `${SITE}/today`, body: { id: "x", message: "y" } },
  { type: "csp-violation", age: 1, url: `${SITE}/map`, body: { effectiveDirective: "connect-src", blockedURL: "wss://socket.evil.example/live?u=1" } },
];

/** The legacy report with another blocked host: each directive and host is logged once an hour (T118). */
const legacyAt = (host: string) => ({ "csp-report": { ...legacy["csp-report"], "blocked-uri": `https://${host}/x.js?token=abc123` } });

let ip = 0;
const post = (body: unknown, contentType: string | null, headers: Record<string, string> = {}) =>
  new Request(SITE + "/api/csp-report", {
    method: "POST",
    headers: { ...(contentType ? { "content-type": contentType } : {}), "x-forwarded-for": `198.51.100.${++ip % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

let lines: string[] = [];
beforeEach(() => {
  lines = [];
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: string) => void lines.push(line));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const logged = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe("CSP report parsing", () => {
  it("reads both content types and nothing else", () => {
    expect(reportFormat("application/csp-report")).toBe("legacy");
    expect(reportFormat("application/reports+json; charset=utf-8")).toBe("reporting-api");
    expect(reportFormat("application/json")).toBeNull();
    expect(reportFormat("text/plain")).toBeNull();
    expect(reportFormat(null)).toBeNull();
  });

  it("extracts the directive and blocked host from both formats", () => {
    expect(parseCspReport("legacy", legacy)).toEqual([{ directive: "script-src-elem", blocked: "cdn.evil.example" }]);
    expect(parseCspReport("reporting-api", reportingApi)).toEqual([
      { directive: "script-src-elem", blocked: "inline" },
      { directive: "connect-src", blocked: "socket.evil.example" },
    ]);
  });

  it("keeps hosts and keywords, never paths, ports, queries or credentials", () => {
    expect(blockedHost("https://user:pass@Fonts.Example.com:444/a/b?c=d#e")).toBe("fonts.example.com");
    expect(blockedHost("eval")).toBe("eval");
    expect(blockedHost("data")).toBe("data");
    expect(blockedHost("data:image/png;base64,AAAA")).toBe("data");
    expect(blockedHost("blob:https://careermetro.test/0b8f8a52")).toBe("blob");
    expect(blockedHost("chrome-extension://abcdef/script.js")).toBe("chrome-extension");
    expect(blockedHost("")).toBe("none");
    expect(blockedHost("not a url at all")).toBe("unknown");
  });

  it("keeps only the directive's name from older browsers that send the whole directive", () => {
    expect(directiveName("script-src 'self' 'unsafe-inline' https://a.example/x")).toBe("script-src");
    expect(directiveName("<script>")).toBe("unknown");
    expect(directiveName(undefined)).toBe("unknown");
  });

  it("falls back to violated-directive and refuses bodies of the wrong shape", () => {
    expect(parseCspReport("legacy", { "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://img.example/a.png" } })).toEqual([
      { directive: "img-src", blocked: "img.example" },
    ]);
    expect(parseCspReport("legacy", reportingApi)).toBeNull();
    expect(parseCspReport("reporting-api", legacy)).toBeNull();
    expect(parseCspReport("reporting-api", [])).toBeNull();
    expect(parseCspReport("reporting-api", [{ type: "deprecation", body: {} }])).toEqual([]);
  });
});

describe("POST /api/csp-report", () => {
  it("logs directive and host only, for both formats, and answers 204", async () => {
    const a = await POST(post(legacy, "application/csp-report"));
    const b = await POST(post(reportingApi, "application/reports+json"));
    expect([a.status, b.status]).toEqual([204, 204]);
    expect(await a.text()).toBe("");
    const events = logged();
    expect(events.map(({ event, directive, blocked }) => ({ event, directive, blocked }))).toEqual([
      { event: "csp_violation", directive: "script-src-elem", blocked: "cdn.evil.example" },
      { event: "csp_violation", directive: "script-src-elem", blocked: "inline" },
      { event: "csp_violation", directive: "connect-src", blocked: "socket.evil.example" },
    ]);
    for (const e of events) expect(Object.keys(e).sort()).toEqual(["at", "blocked", "directive", "event", "level"]);
    for (const line of lines) for (const bit of SECRET_BITS) expect(line).not.toContain(bit);
    expect(m.cookies).not.toHaveBeenCalled();
  });

  it("answers 204 and logs one csp_report_dropped line with a fixed reason for anything it can't use", async () => {
    // Only the byte cap refuses this: the padding is in a field zod drops, and blocked-uri is valid.
    const over = JSON.stringify({ "csp-report": { ...legacy["csp-report"], "script-sample": "x".repeat(70 * 1024) } });
    const cases: [Request, string][] = [
      [post(legacy, "application/json"), "content_type"],
      [post(legacy, null), "content_type"],
      [post("{not json", "application/csp-report"), "bad_json"],
      [post({ hello: "world" }, "application/csp-report"), "bad_shape"],
      [post([{ type: "deprecation", body: {} }], "application/reports+json"), "not_csp"],
      [post(over, "application/csp-report"), "too_large"],
      // A body larger than it claims: the cap holds on the bytes read, not the header.
      [post(over, "application/csp-report", { "content-length": "10" }), "too_large"],
    ];
    for (const [request, reason] of cases) {
      lines = [];
      expect((await POST(request)).status).toBe(204);
      expect(logged().map(({ event, reason: why, ...rest }) => ({ event, reason: why, keys: Object.keys(rest).sort() }))).toEqual([
        { event: "csp_report_dropped", reason, keys: ["at", "level"] },
      ]);
      for (const bit of SECRET_BITS) expect(lines[0]).not.toContain(bit);
    }
  });

  it("logs a valid report just under the byte cap", async () => {
    const under = JSON.stringify({ "csp-report": { ...legacyAt("under-cap.evil.example")["csp-report"], "script-sample": "x".repeat(60 * 1024) } });
    expect(under.length).toBeLessThan(64 * 1024);
    expect((await POST(post(under, "application/csp-report"))).status).toBe(204);
    expect(logged().map(({ event, blocked }) => ({ event, blocked }))).toEqual([{ event: "csp_violation", blocked: "under-cap.evil.example" }]);
    expect(lines[0]).not.toContain("xxx");
  });

  it("stops logging an address after 100 lines an hour, drops included", async () => {
    const same = { "x-forwarded-for": "203.0.113.50" };
    for (let i = 0; i < 99; i++) await POST(post(legacyAt(`h${i}.cap.evil.example`), "application/csp-report", same));
    await POST(post("{not json", "application/csp-report", same));
    await POST(post(legacyAt("h99.cap.evil.example"), "application/csp-report", same));
    await POST(post("{not json", "application/csp-report", same));
    expect(lines).toHaveLength(100);
    expect(logged().at(-1)?.event).toBe("csp_report_dropped");
    // Another address is still heard, and the pair the cap refused is logged once there is room.
    await POST(post(legacyAt("h99.cap.evil.example"), "application/csp-report"));
    expect(lines).toHaveLength(101);
    expect(logged().at(-1)?.blocked).toBe("h99.cap.evil.example");
  });

  it("logs each directive and blocked host once an hour, so one address repeating it can't use up the shared cap (T118)", async () => {
    const noisy = { "x-forwarded-for": "203.0.113.77" };
    for (let i = 0; i < 300; i++) await POST(post(legacyAt("repeat.evil.example"), "application/csp-report", noisy));
    expect(logged().map(({ event, blocked }) => ({ event, blocked }))).toEqual([{ event: "csp_violation", blocked: "repeat.evil.example" }]);
    // Repeats from other addresses, and twice in one batch, aren't logged again either.
    await POST(post(legacyAt("repeat.evil.example"), "application/csp-report"));
    const entry = { type: "csp-violation", age: 1, url: `${SITE}/map`, body: { effectiveDirective: "connect-src", blockedURL: "wss://twice.evil.example/" } };
    const twice = [entry, entry];
    await POST(post(twice, "application/reports+json"));
    expect(logged().map(({ blocked }) => blocked)).toEqual(["repeat.evil.example", "twice.evil.example"]);
    // The noisy address used one line of its 100, so it is still heard for a new pair.
    await POST(post(legacyAt("new.evil.example"), "application/csp-report", noisy));
    expect(logged().map(({ blocked }) => blocked)).toEqual(["repeat.evil.example", "twice.evil.example", "new.evil.example"]);
  });
});

describe("the per-server log guard", () => {
  it("caps each address and everyone together, per window", () => {
    const g = localGuard({ perKey: 3, total: 5, windowMs: 1000 });
    expect([g.take("a", 1, 10), g.take("a", 2, 10), g.take("a", 1, 10)]).toEqual([true, true, false]);
    expect([g.take("b", 2, 10), g.take("c", 1, 10)]).toEqual([true, false]);
    expect(g.take("a", 1, 1010)).toBe(true);
  });

  it("evicts the oldest addresses when full, not the whole map", () => {
    const g = localGuard({ perKey: 1, total: 100, windowMs: 1000, maxKeys: 2 });
    expect([g.take("a", 1, 0), g.take("b", 1, 0)]).toEqual([true, true]);
    expect(g.take("c", 1, 0)).toBe(true); // forgets a, the oldest
    expect(g.take("b", 1, 0)).toBe(false); // b is still counted
    expect(g.take("a", 1, 0)).toBe(true); // a was forgotten
  });
});

describe("the once-a-window memory", () => {
  it("remembers a key until the window ends, and forgets the oldest when full", () => {
    const seen = firstPerWindow({ windowMs: 1000, maxKeys: 2 });
    expect(seen.has("a", 10)).toBe(false);
    seen.add("a", 10);
    expect(seen.has("a", 999)).toBe(true);
    expect(seen.has("a", 1000)).toBe(false); // a new window
    seen.add("a", 1000);
    seen.add("b", 1000);
    seen.add("c", 1000); // forgets a, the oldest
    expect([seen.has("a", 1000), seen.has("b", 1000), seen.has("c", 1000)]).toEqual([false, true, true]);
  });
});

describe("the CSP headers", () => {
  it("builds the report-only policy with report-uri and report-to, and keeps the enforced policy as it was", async () => {
    const headers = (await nextConfig.headers!())[0].headers;
    const value = (key: string) => headers.find((h) => h.key === key)?.value;
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    expect(ENFORCED_CSP).toBe(value("Content-Security-Policy"));
    // Set per request by src/proxy.ts (T118), never fixed at build time here (src/proxy.test.ts checks it is sent).
    expect(value("Content-Security-Policy-Report-Only")).toBeUndefined();
    const reportOnly = cspReportOnly();
    expect(reportOnly).toContain("report-uri /api/csp-report");
    expect(reportOnly).toContain("report-to csp-endpoint");
    expect(reportOnly).toContain("script-src 'self' 'unsafe-inline'");
    expect(reportOnly).not.toContain("form-action");
    expect(value("Reporting-Endpoints")).toBe('csp-endpoint="/api/csp-report"');
    expect(REPORTING_ENDPOINTS).toBe(value("Reporting-Endpoints"));
  });

  it("adds the Vercel Toolbar's hosts only on previews, and 'unsafe-eval' only in development", () => {
    const prod = cspReportOnly();
    expect(prod).not.toContain("vercel.live");
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).toContain("frame-src 'none'");
    const preview = cspReportOnly({ vercelToolbar: true });
    expect(preview).toContain("script-src 'self' 'unsafe-inline' https://vercel.live");
    expect(preview).toContain("frame-src https://vercel.live");
    expect(cspReportOnly({ development: true })).toContain("'unsafe-eval'");
  });
});
