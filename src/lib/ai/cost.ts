/** USD per million tokens, first-party Claude API rates (checked 2026-10-07). Cache writes use the 5-minute rate. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

/** A model we have no price for (for example a refusal fallback) is costed at the highest known rate, so spend is never under-counted. */
const HIGHEST = PRICES["claude-fable-5-1"];

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** Cost of one call in US dollars (AI-6). */
export function costUsd(model: string, usage: Usage): number {
  const price = PRICES[model] ?? HIGHEST;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.input_tokens * perToken(price.input) +
    usage.output_tokens * perToken(price.output) +
    (usage.cache_read_input_tokens ?? 0) * perToken(price.cacheRead) +
    (usage.cache_creation_input_tokens ?? 0) * perToken(price.cacheWrite)
  );
}
