import { APIError } from "@anthropic-ai/sdk";
import { costUsd, type Usage } from "@/lib/ai/cost";
import type { AiCallRecord } from "@/lib/ai/log";
import { describeAiError } from "@/lib/ai/errors";
import { PARSE_MODEL, type ParseResult } from "@/lib/resume/parse";
import { errorFields, logEvent } from "@/lib/log";
import { failureReason, withinLimit } from "@/lib/time-limit";

/** The ping uses the parse model, so it proves access to the model uploads need. */
export const HEALTH_MODEL = PARSE_MODEL;
export const HEALTH_PURPOSE = "health-check";

export type ClaudeStatus = "ok" | "no_key" | "bad_key" | "no_credit" | "no_model_access" | "down";
/** claudeError names a failed ping (status, type and, for a rejected request, the API's reason). The ping's input is fixed text, so the reason can't hold user data. */
/** `schema` is "behind" when the database is missing migrations this build expects (pages that use the new tables fail). */
/** `missingSecrets` names (never shows) production secrets that aren't set; without them the cleanup job can't run. */
/** `market` says whether the Market's rollup table answers a one-row read in time (T122); it never fails the check. */
/** `feed` counts the job boards with a problem on FEED_LIMITS.badRuns daily runs in a row, and the hours since the last run that read a board; it never fails the check, and the smoke check warns on it. */
export type Health = {
  ok: boolean;
  database: "ok" | "down";
  schema?: "ok" | "behind";
  market?: MarketStatus;
  feed?: FeedHealth;
  claude: ClaudeStatus;
  claudeError?: string;
  missingSecrets?: string[];
  env?: DeployEnv;
};

/** "timeout": the read hit its statement or lock limit, or MARKET_CHECK_MS; "missing": no such table (42P01). */
export type MarketStatus = "ok" | "timeout" | "missing" | "error";

/** Board counts only: no board is named on this public page (the feed's run summary names them). */
export type FeedHealth = { deadBoards: number; hoursSinceRun: number | null };

/** FEED_LIMITS.badRuns in src/lib/departures/feed-rules.mjs, which the app doesn't import (a test keeps them equal). */
export const FEED_BAD_RUNS = 3;

/** The health check's own limit on the market read, above the route's 3 s statement limit (it covers a pool wait). */
export const MARKET_CHECK_MS = 4000;

/** Which kind of deployment answers (T107): not secret, and lets the smoke scripts refuse production under any alias. */
export type DeployEnv = "production" | "preview" | "development";

/** VERCEL_ENV as one of three words; anything else (local, CI) is development. */
export function deployEnv(env: Record<string, string | undefined> = process.env): DeployEnv {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview" ? env.VERCEL_ENV : "development";
}

/** Secrets production needs: the cleanup job's key (FR-2's 24-hour delete) and the two hashing keys. */
const PRODUCTION_SECRETS = ["CRON_SECRET", "NAME_HASH_KEY", "IP_HASH_KEY"] as const;

/** The production secrets that aren't set. Previews and local development fall back on purpose, so they need none. */
export function missingSecrets(env: Record<string, string | undefined> = process.env): string[] {
  if (env.VERCEL_ENV !== "production") return [];
  return PRODUCTION_SECRETS.filter((name) => !env[name]);
}

export type HealthDeps = {
  hasKey: boolean;
  pingDb: () => Promise<void>;
  /** The smallest real call to the model the app uses, so it proves the key, the credit and access to that model. */
  pingClaude: () => Promise<{ model: string; usage: Usage }>;
  record: (call: AiCallRecord) => Promise<void>;
  /** How many migrations the database has applied, and how many this build's journal lists. */
  countMigrations?: () => Promise<{ applied: number; expected: number }>;
  /** A one-row read of market_openings_monthly under its own statement limit (T122): the table only /market reads. */
  readMarket?: () => Promise<void>;
  /** The boards at the bad-run limit and the last run that read a board (job_feed_boards, job_feed_runs). */
  readFeed?: () => Promise<{ deadBoards: number; lastRunAt: Date | null }>;
  /** The time `hoursSinceRun` counts from; now when unset. */
  now?: Date;
  /** From missingSecrets(). */
  missingSecrets?: string[];
  /** From deployEnv(), shown as `env`. */
  env?: DeployEnv;
};

/** Says whether the database and the Claude API work, naming the cause when Claude doesn't. Never returns the key; for a rejected request it returns the API's reason, which can't hold user data because the ping's input is fixed. */
export async function checkHealth(deps: HealthDeps): Promise<Health> {
  const [database, { status: claude, error }] = await Promise.all([checkDb(deps), checkClaude(deps)]);
  const [schema, market, feed] =
    database === "ok" ? await Promise.all([checkSchema(deps), checkMarket(deps), checkFeed(deps)]) : ([undefined, undefined, undefined] as const);
  const missing = deps.missingSecrets?.length ? deps.missingSecrets : undefined;
  if (missing) logEvent("error", "health_secrets_missing", { missing: missing.join(",") });
  return {
    ok: database === "ok" && schema !== "behind" && claude === "ok" && !missing,
    database,
    ...(schema ? { schema } : {}),
    ...(market ? { market } : {}),
    ...(feed ? { feed } : {}),
    claude,
    ...(error ? { claudeError: error } : {}),
    ...(missing ? { missingSecrets: missing } : {}),
    ...(deps.env ? { env: deps.env } : {}),
  };
}

async function checkSchema(deps: HealthDeps): Promise<Health["schema"]> {
  if (!deps.countMigrations) return undefined;
  try {
    const { applied, expected } = await deps.countMigrations();
    if (applied < expected) logEvent("error", "health_schema_behind", { applied, expected });
    return applied < expected ? "behind" : "ok";
  } catch (error) {
    logEvent("error", "health_schema_failed", errorFields(error));
    // No migrations table (or schema) at all means nothing has been applied; any other failure gives no verdict.
    return MISSING_CODES.has(pgCode(error)) ? "behind" : undefined;
  }
}

/** Never throws and never changes `ok`: it only names how the read went, in one word. */
async function checkMarket(deps: HealthDeps): Promise<MarketStatus | undefined> {
  if (!deps.readMarket) return undefined;
  try {
    await withinLimit(deps.readMarket(), MARKET_CHECK_MS);
    return "ok";
  } catch (error) {
    const reason = failureReason(error);
    logEvent("error", "health_market_failed", { ...errorFields(error), reason });
    if (reason === "missing") return "missing";
    return reason === "error" ? "error" : "timeout";
  }
}

/** Never throws and never changes `ok`: a read that fails or runs past MARKET_CHECK_MS leaves `feed` out. */
async function checkFeed(deps: HealthDeps): Promise<FeedHealth | undefined> {
  if (!deps.readFeed) return undefined;
  try {
    const { deadBoards, lastRunAt } = await withinLimit(deps.readFeed(), MARKET_CHECK_MS);
    const now = (deps.now ?? new Date()).getTime();
    return { deadBoards, hoursSinceRun: lastRunAt ? Math.max(0, Math.floor((now - lastRunAt.getTime()) / 3_600_000)) : null };
  } catch (error) {
    logEvent("error", "health_feed_failed", { ...errorFields(error), reason: failureReason(error) });
    return undefined;
  }
}

/** Postgres codes for an undefined table (42P01) and an undefined schema (3F000). */
const MISSING_CODES = new Set<string | undefined>(["42P01", "3F000"]);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

async function checkDb(deps: HealthDeps): Promise<Health["database"]> {
  try {
    await deps.pingDb();
    return "ok";
  } catch (error) {
    logEvent("error", "health_db_failed", errorFields(error));
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
    logEvent("error", "health_claude_failed", { status, ...errorFields(error) });
    call = { model: HEALTH_MODEL, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  await deps
    .record({ purpose: HEALTH_PURPOSE, promptVersion: "health-check/none", inputRefs: {}, latencyMs: Date.now() - started, ok: status === "ok", ...call })
    .catch((error) => logEvent("error", "health_record_failed", errorFields(error)));
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
