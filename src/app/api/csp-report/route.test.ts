import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The CSP report endpoint: both report formats, directive and host only in the logs, always 204, and no session.
const m = vi.hoisted(() => ({
  takeShared: vi.fn<(limit: { bucket: string; max: number }, key: string) => Promise<boolean>>(async () => true),
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
vi.mock("@/lib/shared-limit", async (original) => ({ ...(await original<typeof import("@/lib/shared-limit")>()), takeShared: m.takeShared }));

import { POST } from "@/app/api/csp-report/route";
import { blockedHost, directiveName, parseCspReport, reportFormat } from "@/lib/csp-report";
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
    expect(m.takeShared).toHaveBeenCalledTimes(2);
    expect(m.takeShared.mock.calls[0][0].bucket).toBe("csp-report");
    expect(m.cookies).not.toHaveBeenCalled();
  });

  it("answers 204 and logs nothing for other content types, invalid JSON, wrong shapes and oversize bodies", async () => {
    const big = JSON.stringify({ "csp-report": { "effective-directive": "script-src", "blocked-uri": "https://a.example/" + "x".repeat(20_000) } });
    const requests = [
      post(legacy, "application/json"),
      post(legacy, null),
      post("{not json", "application/csp-report"),
      post({ hello: "world" }, "application/csp-report"),
      post([{ type: "deprecation", body: {} }], "application/reports+json"),
      post(big, "application/csp-report"),
      // A body larger than it claims: the cap holds on the bytes read, not the header.
      post(big, "application/csp-report", { "content-length": "10" }),
    ];
    for (const r of requests) expect((await POST(r)).status).toBe(204);
    expect(lines).toEqual([]);
    expect(m.takeShared).not.toHaveBeenCalled();
  });

  it("answers 204 and logs nothing once an address is over its limit", async () => {
    m.takeShared.mockResolvedValueOnce(false);
    expect((await POST(post(legacy, "application/csp-report"))).status).toBe(204);
    expect(lines).toEqual([]);
  });

  it("stops at the per-server guard before the shared limit is asked", async () => {
    const same = { "x-forwarded-for": "203.0.113.50" };
    for (let i = 0; i < 101; i++) await POST(post(legacy, "application/csp-report", same));
    expect(m.takeShared).toHaveBeenCalledTimes(100);
    expect(lines).toHaveLength(100);
  });
});

describe("the CSP headers", () => {
  it("sends the report-only policy with report-uri and report-to, and keeps the enforced policy as it was", async () => {
    const headers = (await nextConfig.headers!())[0].headers;
    const value = (key: string) => headers.find((h) => h.key === key)?.value;
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    expect(ENFORCED_CSP).toBe(value("Content-Security-Policy"));
    const reportOnly = value("Content-Security-Policy-Report-Only")!;
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
