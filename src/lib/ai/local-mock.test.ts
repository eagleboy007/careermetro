import { describe, expect, it } from "vitest";
import { localMockActive } from "./local-mock";

describe("localMockActive", () => {
  it("is on when the Claude API points at this machine", () => {
    expect(localMockActive({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4011" })).toBe(true);
    expect(localMockActive({ ANTHROPIC_BASE_URL: "http://localhost:4011", VERCEL_ENV: "preview" })).toBe(true);
    expect(localMockActive({ ANTHROPIC_BASE_URL: "http://[::1]:4011" })).toBe(true);
  });

  it("is off for the real API, a bad link, and always on production", () => {
    expect(localMockActive({})).toBe(false);
    expect(localMockActive({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })).toBe(false);
    expect(localMockActive({ ANTHROPIC_BASE_URL: "not a link" })).toBe(false);
    expect(localMockActive({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4011", VERCEL_ENV: "production" })).toBe(false);
  });
});
