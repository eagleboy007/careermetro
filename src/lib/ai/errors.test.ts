import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { describeAiError } from "./errors";

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
