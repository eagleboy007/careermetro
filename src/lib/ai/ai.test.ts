import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { costUsd } from "./cost";
import { loadPrompt, PROMPT_VERSIONS } from "./prompts";

describe("costUsd", () => {
  it("prices Opus 5.5 input, output and cache tokens", () => {
    expect(costUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(costUsd("claude-opus-5-5", { input_tokens: 3000, output_tokens: 2000 })).toBeCloseTo(0.052);
    expect(
      costUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }),
    ).toBeCloseTo(5.2);
  });

  it("never under-counts an unknown model", () => {
    expect(costUsd("claude-new-model", { input_tokens: 1_000_000, output_tokens: 0 })).toBeGreaterThanOrEqual(10);
  });
});

describe("prompts", () => {
  it("has a file for every current prompt version", () => {
    for (const [name, version] of Object.entries(PROMPT_VERSIONS)) {
      expect(existsSync(`prompts/${name}/v${version}.md`)).toBe(true);
    }
  });

  it("loads a prompt with an id for the ai_calls log", () => {
    const p = loadPrompt("parse-resume");
    expect(p.id).toBe("parse-resume/v1");
    expect(p.text).toContain("<resume>");
  });
});
