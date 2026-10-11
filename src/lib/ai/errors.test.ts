import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { describeAiError, isTransient, withOneRetry } from "./errors";

describe("describeAiError", () => {
  it("names the status, error type and request id of an API error, never its message", () => {
    const error = APIError.generate(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      "secret detail",
      new Headers({ "request-id": "req_123" }),
    );
    const text = describeAiError(error);
    expect(text).toBe("api_error status=401 type=authentication_error request_id=req_123");
    expect(text).not.toContain("secret detail");
  });

  it("labels errors that have no status", () => {
    expect(describeAiError(new APIConnectionTimeoutError())).toBe("timeout");
    expect(describeAiError(new APIConnectionError({ message: "fetch failed" }))).toBe("connection");
    expect(describeAiError(new APIUserAbortError())).toBe("aborted");
  });

  it("gives only the name of any other error", () => {
    expect(describeAiError(new TypeError("resume text here"))).toBe("TypeError");
    expect(describeAiError("boom")).toBe("string");
  });
});

const apiError = (status: number) => APIError.generate(status, { type: "error", error: { type: "x", message: "m" } }, "m", new Headers());

describe("isTransient", () => {
  it("retries rate limits, overload, server errors and dropped connections", () => {
    for (const status of [408, 429, 500, 503, 529]) expect(isTransient(apiError(status))).toBe(true);
    expect(isTransient(new APIConnectionError({ message: "reset" }))).toBe(true);
  });

  it("never retries a timeout, an abort, a request error or a non-API error", () => {
    for (const status of [400, 401, 403, 404, 413]) expect(isTransient(apiError(status))).toBe(false);
    expect(isTransient(new APIConnectionTimeoutError())).toBe(false);
    expect(isTransient(new APIUserAbortError())).toBe(false);
    expect(isTransient(new TypeError("x"))).toBe(false);
  });
});

describe("withOneRetry", () => {
  const opts = (errors: unknown[]) => ({ budgetMs: 20_000, minRetryMs: 5_000, onError: (e: unknown) => errors.push(e), pause: async () => {} });

  it("tries once more after a transient failure and returns the second answer", async () => {
    const errors: unknown[] = [];
    const run = vi.fn().mockRejectedValueOnce(apiError(529)).mockResolvedValueOnce("ok");
    await expect(withOneRetry(run, opts(errors))).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });

  it("does not retry a request error, and retries a transient one only once", async () => {
    const errors: unknown[] = [];
    const bad = vi.fn().mockRejectedValue(apiError(400));
    await expect(withOneRetry(bad, opts(errors))).rejects.toBeInstanceOf(APIError);
    expect(bad).toHaveBeenCalledTimes(1);
    const down = vi.fn().mockRejectedValue(apiError(503));
    await expect(withOneRetry(down, opts(errors))).rejects.toBeInstanceOf(APIError);
    expect(down).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(3);
  });

  it("gives up rather than retry with too little of the budget left", async () => {
    const run = vi.fn().mockRejectedValue(apiError(429));
    await expect(withOneRetry(run, { budgetMs: 4_000, minRetryMs: 5_000, onError: () => {}, pause: async () => {} })).rejects.toBeInstanceOf(APIError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives each attempt what is left of the budget as its timeout", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await withOneRetry(run, { budgetMs: 15_000, minRetryMs: 5_000, onError: () => {} });
    expect(run.mock.calls[0][0]).toBeGreaterThan(14_000);
    expect(run.mock.calls[0][0]).toBeLessThanOrEqual(15_000);
  });
});
