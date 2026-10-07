import { APIError } from "@anthropic-ai/sdk";
import { costUsd, type Usage } from "@/lib/ai/cost";
import type { AiCallRecord } from "@/lib/ai/log";
import { describeAiError } from "@/lib/ai/errors";

export const HEALTH_MODEL = "claude-opus-5-5";

export type ClaudeStatus = "ok" | "no_key" | "bad_key" | "no_credit" | "no_model_access" | "down";
export type Health = { ok: boolean; database: "ok" | "down"; claude: ClaudeStatus };

export type HealthDeps = {
  hasKey: boolean;
  pingDb: () => Promise<void>;
  /** The smallest real call to the model the app uses, so it proves the key, the credit and access to that model. */
  pingClaude: () => Promise<{ model: string; usage: Usage }>;
  record: (call: AiCallRecord) => Promise<void>;
};

/** Says whether the database and the Claude API work, naming the cause when Claude doesn't. Never returns the key or error messages. */
export async function checkHealth(deps: HealthDeps): Promise<Health> {
  const [database, claude] = await Promise.all([checkDb(deps), checkClaude(deps)]);
  return { ok: database === "ok" && claude === "ok", database, claude };
}

async function checkDb(deps: HealthDeps): Promise<Health["database"]> {
  try {
    await deps.pingDb();
    return "ok";
  } catch (error) {
    console.error("health: database check failed:", error instanceof Error ? error.name : typeof error);
    return "down";
  }
}

async function checkClaude(deps: HealthDeps): Promise<ClaudeStatus> {
  if (!deps.hasKey) return "no_key";
  const started = Date.now();
  let status: ClaudeStatus;
  let call: Pick<AiCallRecord, "model" | "inputTokens" | "outputTokens" | "costUsd">;
  try {
    const { model, usage } = await deps.pingClaude();
    status = "ok";
    call = { model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd: costUsd(model, usage) };
  } catch (error) {
    status = classify(error);
    console.error("health: claude check failed:", describeAiError(error));
    call = { model: HEALTH_MODEL, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  await deps
    .record({ purpose: "health-check", promptVersion: "health-check/none", inputRefs: {}, latencyMs: Date.now() - started, ok: status === "ok", ...call })
    .catch((error) => console.error("health: logging the call failed:", error instanceof Error ? error.name : typeof error));
  return status;
}

function classify(error: unknown): ClaudeStatus {
  if (!(error instanceof APIError)) return "down";
  if (error.status === 401) return "bad_key";
  if (error.status === 403 || error.status === 404) return "no_model_access";
  // The API reports an empty balance as a 400 whose message names the credit balance.
  if (error.status === 400 && /credit balance/i.test(error.message)) return "no_credit";
  return "down";
}
