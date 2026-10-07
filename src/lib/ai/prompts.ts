import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

export type PromptName = "parse-resume";

export type Prompt = { name: PromptName; version: number; id: string; text: string };

/** Current version of each prompt. Bump it after adding prompts/<name>/v<N>.md and running the evals. */
export const PROMPT_VERSIONS: Record<PromptName, number> = { "parse-resume": 1 };

const cache = new Map<string, Prompt>();

/** Loads a versioned prompt file (AI-3). The id, such as "parse-resume/v1", is logged on every call. */
export function loadPrompt(name: PromptName, version = PROMPT_VERSIONS[name]): Prompt {
  const id = `${name}/v${version}`;
  const cached = cache.get(id);
  if (cached) return cached;
  const text = readFileSync(path.join(process.cwd(), "prompts", name, `v${version}.md`), "utf8").trim();
  const prompt = { name, version, id, text };
  cache.set(id, prompt);
  return prompt;
}
