import { APIError } from "@anthropic-ai/sdk";
import { costUsd, type Usage } from "@/lib/ai/cost";
import type { AiCallRecord } from "@/lib/ai/log";
import { describeAiError } from "@/lib/ai/errors";
import { PARSE_MODEL, type ParseResult } from "@/lib/resume/parse";

/** The ping uses the parse model, so it proves access to the model uploads need. */
export const HEALTH_MODEL = PARSE_MODEL;
export const HEALTH_PURPOSE = "health-check";

export type ClaudeStatus = "ok" | "no_key" | "bad_key" | "no_credit" | "no_model_access" | "down";
/** claudeError names a failed ping (status, type and, for a rejected request, the API's reason). The ping's input is fixed text, so the reason can't hold user data. */
export type Health = { ok: boolean; database: "ok" | "down"; claude: ClaudeStatus; claudeError?: string };

export type HealthDeps = {
  hasKey: boolean;
  pingDb: () => Promise<void>;
  /** The smallest real call to the model the app uses, so it proves the key, the credit and access to that model. */
  pingClaude: () => Promise<{ model: string; usage: Usage }>;
  record: (call: AiCallRecord) => Promise<void>;
};

/** Says whether the database and the Claude API work, naming the cause when Claude doesn't. Never returns the key; for a rejected request it returns the API's reason, which can't hold user data because the ping's input is fixed. */
export async function checkHealth(deps: HealthDeps): Promise<Health> {
  const [database, { status: claude, error }] = await Promise.all([checkDb(deps), checkClaude(deps)]);
  return { ok: database === "ok" && claude === "ok", database, claude, ...(error ? { claudeError: error } : {}) };
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

async function checkClaude(deps: HealthDeps): Promise<{ status: ClaudeStatus; error?: string }> {
  if (!deps.hasKey) return { status: "no_key" };
  const started = Date.now();
  let status: ClaudeStatus;
  let failure: string | undefined;
  let call: Pick<AiCallRecord, "model" | "inputTokens" | "outputTokens" | "costUsd">;
  try {
    const { model, usage } = await deps.pingClaude();
    status = "ok";
    call = { model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd: costUsd(model, usage) };
  } catch (error) {
    status = classify(error);
    failure = describeFailure(error);
    console.error("health: claude check failed:", failure);
    call = { model: HEALTH_MODEL, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  await deps
    .record({ purpose: HEALTH_PURPOSE, promptVersion: "health-check/none", inputRefs: {}, latencyMs: Date.now() - started, ok: status === "ok", ...call })
    .catch((error) => console.error("health: logging the call failed:", error instanceof Error ? error.name : typeof error));
  return { status, error: failure };
}

function classify(error: unknown): ClaudeStatus {
  if (!(error instanceof APIError)) return "down";
  if (error.status === 401) return "bad_key";
  if (error.status === 403 || error.status === 404) return "no_model_access";
  // The API reports an empty balance as a 400 whose message names the credit balance.
  if (error.status === 400 && /credit balance/i.test(error.message)) return "no_credit";
  return "down";
}

/** describeAiError plus, for a rejected request, the API's reason. Only for requests whose input is fixed text. */
export function describeFailure(error: unknown): string {
  let text = describeAiError(error);
  if (error instanceof APIError && error.status === 400) {
    // The API's own message, not the SDK's, which repeats the whole JSON body.
    const body = error.error as { error?: { message?: unknown } } | undefined;
    const reason = typeof body?.error?.message === "string" ? body.error.message : error.message;
    text += ` reason=${reason.slice(0, 300)}`;
  }
  return text;
}

export type ParseHealth = { ok: boolean; parse: "ok" | "refused" | "malformed" | "down"; parseError?: string };

/** Runs the real resume-parse request on a synthetic resume, so a failure the small ping can't see (the prompt, the output schema) shows up. */
export async function checkParse(parse: () => Promise<ParseResult>): Promise<ParseHealth> {
  try {
    const result = await parse();
    if (result.ok) return { ok: true, parse: "ok" };
    if (result.reason === "unavailable") return { ok: false, parse: "down", parseError: describeFailure(result.error) };
    return { ok: false, parse: result.reason };
  } catch (error) {
    return { ok: false, parse: "down", parseError: describeFailure(error) };
  }
}

/** Invented for the parse check; no real person. */
export const SYNTHETIC_RESUME = `Asha Verma
Data Analyst, Pune

Experience
Data Analyst, Example Retail Pvt Ltd, Jan 2022 to present
- Built weekly sales dashboards in Power BI for 40 stores.
- Wrote SQL queries in PostgreSQL to find slow-moving stock, cutting excess inventory by 12%.

Education
B.Com, Savitribai Phule Pune University, 2021

Skills: Excel, SQL, Power BI`;
