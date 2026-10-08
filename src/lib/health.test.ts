import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { checkHealth, checkParse, type HealthDeps } from "./health";

const usage = { input_tokens: 8, output_tokens: 1 };

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    hasKey: true,
    pingDb: vi.fn(async () => {}),
    pingClaude: vi.fn(async () => ({ model: "claude-opus-5-5", usage })),
    record: vi.fn(async () => {}),
    ...overrides,
  };
}

function apiError(status: number, type: string, message: string) {
  return APIError.generate(status, { type: "error", error: { type, message } }, message, new Headers());
}

describe("checkHealth", () => {
  it("is ok when the database and Claude both answer", async () => {
    const d = deps();
    expect(await checkHealth(d)).toEqual({ ok: true, database: "ok", claude: "ok" });
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ purpose: "health-check", ok: true, inputTokens: 8 }));
  });

  it("names a missing key without calling Claude", async () => {
    const d = deps({ hasKey: false });
    expect(await checkHealth(d)).toEqual({ ok: false, database: "ok", claude: "no_key" });
    expect(d.pingClaude).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(401, "authentication_error", "invalid x-api-key"), "bad_key"],
    [apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."), "no_credit"],
    [apiError(403, "permission_error", "no access"), "no_model_access"],
    [apiError(404, "not_found_error", "model: claude-opus-5-5"), "no_model_access"],
    [apiError(529, "overloaded_error", "Overloaded"), "down"],
    [new APIConnectionError({ message: "fetch failed" }), "down"],
  ])("classifies %s", async (error, claude) => {
    const d = deps({ pingClaude: vi.fn(async () => Promise.reject(error)) });
    expect(await checkHealth(d)).toMatchObject({ ok: false, database: "ok", claude, claudeError: expect.any(String) });
    expect(d.record).toHaveBeenCalledWith(expect.objectContaining({ ok: false, costUsd: 0 }));
  });

  it("gives the API's reason for a rejected ping", async () => {
    const d = deps({ pingClaude: vi.fn(async () => Promise.reject(apiError(400, "invalid_request_error", "fallbacks: unknown field"))) });
    const health = await checkHealth(d);
    expect(health.claude).toBe("down");
    expect(health.claudeError).toMatch(/^api_error status=400 type=invalid_request_error reason=.*fallbacks: unknown field/);
  });

  it("reports a database that is down, and still checks Claude", async () => {
    const d = deps({ pingDb: vi.fn(async () => Promise.reject(new Error("connect ECONNREFUSED"))) });
    expect(await checkHealth(d)).toEqual({ ok: false, database: "down", claude: "ok" });
    expect(d.pingClaude).toHaveBeenCalled();
  });

  it("does not fail the check when logging the call fails", async () => {
    const d = deps({ record: vi.fn(async () => Promise.reject(new Error("insert failed"))) });
    expect(await checkHealth(d)).toEqual({ ok: true, database: "ok", claude: "ok" });
  });
});

describe("checkParse", () => {
  it("is ok when the parse succeeds", async () => {
    const result = { ok: true, profile: {}, report: {}, calls: [] } as never;
    expect(await checkParse(async () => result)).toEqual({ ok: true, parse: "ok" });
  });

  it("gives the reason when the parse request is rejected", async () => {
    const error = apiError(400, "invalid_request_error", "output_config.format: schema too complex");
    const health = await checkParse(async () => ({ ok: false, reason: "unavailable", error, calls: [] }));
    expect(health).toEqual({ ok: false, parse: "down", parseError: expect.stringMatching(/status=400 .*reason=output_config\.format: schema too complex$/) });
  });

  it("names a malformed result", async () => {
    expect(await checkParse(async () => ({ ok: false, reason: "malformed", calls: [] }))).toEqual({ ok: false, parse: "malformed" });
  });
});
