import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { checkHealth, checkParse, deployEnv, missingSecrets, type HealthDeps } from "./health";

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

  it("says when the database is missing migrations this build needs", async () => {
    expect(await checkHealth(deps({ countMigrations: async () => ({ applied: 13, expected: 13 }) }))).toEqual({ ok: true, database: "ok", schema: "ok", claude: "ok" });
    expect(await checkHealth(deps({ countMigrations: async () => ({ applied: 12, expected: 13 }) }))).toMatchObject({ ok: false, schema: "behind" });
    const missing = Object.assign(new Error('relation "drizzle.__drizzle_migrations" does not exist'), { code: "42P01" });
    expect(await checkHealth(deps({ countMigrations: async () => Promise.reject(missing) }))).toMatchObject({ ok: false, schema: "behind" });
    // Any other failure to read the count gives no verdict and doesn't fail the check.
    const timeout = await checkHealth(deps({ countMigrations: async () => Promise.reject(new Error("statement timeout")) }));
    expect(timeout).toEqual({ ok: true, database: "ok", claude: "ok" });
    // A database that is down is reported as down, without a schema verdict.
    const down = await checkHealth(deps({ pingDb: async () => Promise.reject(new Error("down")), countMigrations: async () => ({ applied: 0, expected: 13 }) }));
    expect(down).not.toHaveProperty("schema");
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

describe("missingSecrets", () => {
  const all = { CRON_SECRET: "a", NAME_HASH_KEY: "b", IP_HASH_KEY: "c" };
  it("names the production secrets that aren't set, so a missing cron key can't go unnoticed", () => {
    expect(missingSecrets({ VERCEL_ENV: "production" })).toEqual(["CRON_SECRET", "NAME_HASH_KEY", "IP_HASH_KEY"]);
    expect(missingSecrets({ VERCEL_ENV: "production", ...all, IP_HASH_KEY: "" })).toEqual(["IP_HASH_KEY"]);
    expect(missingSecrets({ VERCEL_ENV: "production", ...all })).toEqual([]);
  });
  it("asks nothing of previews and local development", () => {
    expect(missingSecrets({ VERCEL_ENV: "preview" })).toEqual([]);
    expect(missingSecrets({})).toEqual([]);
  });
  it("turns health red and lists the names, never the values", async () => {
    const d = deps({ missingSecrets: ["CRON_SECRET"] });
    expect(await checkHealth(d)).toEqual({ ok: false, database: "ok", claude: "ok", missingSecrets: ["CRON_SECRET"] });
    expect(await checkHealth(deps({ missingSecrets: [] }))).toEqual({ ok: true, database: "ok", claude: "ok" });
  });
});

describe("deployEnv", () => {
  it("names the kind of deployment, so the smoke scripts can refuse production under any alias (T107)", async () => {
    expect(deployEnv({ VERCEL_ENV: "production" })).toBe("production");
    expect(deployEnv({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(deployEnv({ VERCEL_ENV: "development" })).toBe("development");
    expect(deployEnv({})).toBe("development");
    expect(deployEnv({ VERCEL_ENV: "staging" })).toBe("development");
    // Shown on health, red or green, and nothing else rides along.
    expect(await checkHealth(deps({ env: "production" }))).toEqual({ ok: true, database: "ok", claude: "ok", env: "production" });
    expect(await checkHealth(deps({ env: "preview", hasKey: false }))).toEqual({ ok: false, database: "ok", claude: "no_key", env: "preview" });
  });
});
