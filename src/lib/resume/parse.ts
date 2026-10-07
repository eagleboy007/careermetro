import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { costUsd } from "@/lib/ai/cost";
import { describeAiError } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import { profile as profileSchema, type Profile } from "@/lib/schemas";
import { verifyProfile, type VerifyReport } from "./verify";

export const PARSE_MODEL = "claude-opus-5-5";
const MAX_ATTEMPTS = 2;
/** The upload route's maxDuration is 120 s; parsing must finish well inside it, leaving time to save the result. */
export const PARSE_DEADLINE_MS = 100_000;
const ATTEMPT_TIMEOUT_MS = 50_000;
/** A retry is only worth starting with at least this much of the deadline left. */
const MIN_ATTEMPT_MS = 30_000;

export type ParseClient = Pick<Anthropic, "beta">;

export type ParseResult =
  | { ok: true; profile: Profile; report: VerifyReport; calls: AiCallRecord[] }
  | { ok: false; reason: "refused" | "malformed" | "unavailable"; calls: AiCallRecord[] };

/** Wraps the resume so the model reads it as data (AI-7). A closing tag inside the resume can't end the block early. */
export function wrapResume(maskedText: string): string {
  return `<resume>\n${maskedText.replace(/<\/?resume>/gi, (tag) => tag.replace("<", "&lt;").replace(">", "&gt;"))}\n</resume>`;
}

/** The profile from the response's text block, or null if it is missing, not JSON, or fails the schema. */
export function readProfile(content: Anthropic.Beta.BetaContentBlock[]): Profile | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    const result = profileSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic({ timeout: ATTEMPT_TIMEOUT_MS, maxRetries: 0 });
  return defaultClient;
}

/**
 * FR-5: turns masked resume text into a profile with one model call, retried once if the output is malformed (FR-14).
 * The text must already be masked with maskPii. The result is verified against that same text (AI-5).
 * inputRefs identifies the resume for the ai_calls log and must hold ids only.
 * Never throws for a failed call: every attempt, including one that errors, is returned in `calls` for logging.
 */
export async function parseResume(
  maskedText: string,
  inputRefs: Record<string, string>,
  client: ParseClient = getClient(),
  deadlineMs = PARSE_DEADLINE_MS,
): Promise<ParseResult> {
  const prompt = loadPrompt("parse-resume");
  const calls: AiCallRecord[] = [];
  const deadline = Date.now() + deadlineMs;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt > 1 && remaining < MIN_ATTEMPT_MS) break;
    const started = Date.now();
    const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean) =>
      calls.push({
        purpose: "parse-resume",
        model,
        promptVersion: prompt.id,
        inputRefs,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        costUsd: usage ? costUsd(model, usage) : 0,
        latencyMs: Date.now() - started,
        ok,
      });

    let response;
    try {
      const timeout = Math.max(1_000, Math.min(ATTEMPT_TIMEOUT_MS, remaining));
      response = await client.beta.messages.create(
        {
          model: PARSE_MODEL,
          max_tokens: 16_000,
          system: prompt.text,
          messages: [{ role: "user", content: wrapResume(maskedText) }],
          output_config: { effort: "medium", format: betaZodOutputFormat(profileSchema) },
          // Re-runs a refused request on a fallback model chosen by the API, inside the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { timeout },
      );
    } catch (error) {
      record(PARSE_MODEL, null, false);
      // Never the message: it could echo the request, which holds resume text.
      console.error("parse-resume call failed:", describeAiError(error));
      return { ok: false, reason: "unavailable", calls };
    }

    if (response.stop_reason === "refusal") {
      record(response.model, response.usage, false);
      return { ok: false, reason: "refused", calls };
    }
    // Validated here rather than by the SDK's parse helper so the tokens of a malformed attempt are still logged.
    const parsed = response.stop_reason === "max_tokens" ? null : readProfile(response.content);
    record(response.model, response.usage, parsed !== null);
    if (parsed) {
      const { profile, report } = verifyProfile(parsed, maskedText);
      return { ok: true, profile, report, calls };
    }
  }
  return { ok: false, reason: "malformed", calls };
}
