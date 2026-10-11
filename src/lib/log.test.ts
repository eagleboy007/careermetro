import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, logEvent, logLine, REDACTED } from "./log";

const at = new Date("2026-10-11T10:00:00Z");
const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

describe("logLine", () => {
  it("writes one JSON object with level, event, time and the fields", () => {
    const line = logLine("error", "gaps_failed", { route: "/resume/[id]/gaps/[slug]", ms: 1200, code: "55P03", ok: false }, at);
    expect(line).not.toContain("\n");
    expect(parse(line)).toEqual({
      level: "error",
      event: "gaps_failed",
      at: "2026-10-11T10:00:00.000Z",
      route: "/resume/[id]/gaps/[slug]",
      ms: 1200,
      code: "55P03",
      ok: false,
    });
  });

  it.each([
    ["a name", "Priya Sharma"],
    ["an email", "priya@example.com"],
    ["a phone number", "+91 98765 43210"],
    ["a resume sentence", "Led SOC triage for 40 analysts"],
    ["a long string", "a".repeat(121)],
    ["a newline", "abc\ndef"],
    ["a quote", 'x"y'],
  ])("redacts %s", (_, value) => {
    expect(parse(logLine("info", "e", { value }, at)).value).toBe(REDACTED);
  });

  it("keeps ids, codes, routes and request ids", () => {
    for (const value of ["8a1f0c2e-5b7d-4e8a-9c3f-1d2e3f4a5b6c", "23505", "/api/path-steps/[id]", "req_011CfvHGiTxdmVmT8DWfm479", "gpt=2"]) {
      expect(parse(logLine("info", "e", { value }, at)).value).toBe(value);
    }
  });

  it("drops unsafe keys and keys that would overwrite level, event or time", () => {
    const out = parse(logLine("info", "e", { "Priya Sharma": "x", level: "info2", event: "x", at: "x", "bad-key": 1, good: 1 }, at));
    expect(out).toEqual({ level: "info", event: "e", at: "2026-10-11T10:00:00.000Z", good: 1 });
  });

  it("drops undefined, turns non-finite numbers into null and redacts an unsafe event name", () => {
    expect(parse(logLine("info", "Priya's upload", { a: undefined, b: Number.NaN, c: null }, at))).toEqual({
      level: "info",
      event: REDACTED,
      at: "2026-10-11T10:00:00.000Z",
      b: null,
      c: null,
    });
  });
});

describe("logEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends errors and warnings to stderr and info to stdout", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("error", "a");
    logEvent("warn", "b");
    logEvent("info", "c");
    expect(parse(error.mock.calls[0][0] as string).event).toBe("a");
    expect(parse(warn.mock.calls[0][0] as string).event).toBe("b");
    expect(parse(log.mock.calls[0][0] as string).event).toBe("c");
  });
});

describe("errorFields", () => {
  it("never includes the message", () => {
    const error = new Error("insert into resumes values ('Priya Sharma')", { cause: { code: "23505" } });
    const fields = errorFields(error);
    expect(fields).toEqual({ error: "Error", code: "23505", digest: undefined });
    expect(JSON.stringify(fields)).not.toContain("Priya");
  });

  it("reads a code on the error itself and React's digest", () => {
    const error = Object.assign(new TypeError("x"), { code: "ECONNRESET", digest: "1234567" });
    expect(errorFields(error)).toEqual({ error: "TypeError", code: "ECONNRESET", digest: "1234567" });
  });

  it("labels Anthropic errors with fixed strings", () => {
    expect(errorFields(new APIConnectionTimeoutError())).toEqual({ error: "timeout" });
    expect(errorFields(new APIUserAbortError())).toEqual({ error: "aborted" });
    expect(errorFields(new APIConnectionError({ message: "reset" }))).toEqual({ error: "connection" });
    const api = APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "m", new Headers({ "request-id": "req_1" }));
    expect(errorFields(api)).toEqual({ error: "api_error", status: 429, type: "rate_limit_error", requestId: "req_1" });
  });

  it("describes a thrown non-error by its type", () => {
    expect(errorFields("Priya")).toEqual({ error: "string" });
  });
});
