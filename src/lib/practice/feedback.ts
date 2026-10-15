import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { costUsd } from "@/lib/ai/cost";
import { withOneRetry } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import { errorFields, logEvent } from "@/lib/log";
import { practiceFeedback, type PracticeFeedback } from "@/lib/schemas";

export const PRACTICE_MODEL = "claude-opus-5-5";
/** The person waits on this call after "Get feedback": one retry inside this budget for an outage, else no feedback. */
const TIMEOUT_MS = 20_000;
/** A retry starts only with at least this much of the budget left. */
const MIN_RETRY_MS = 5_000;

export type FeedbackClient = Pick<Anthropic, "beta">;

export type FeedbackInput = { skillName: string; question: string; lookFor: string; answer: string };
export type FeedbackResult = { feedback: PracticeFeedback | null; calls: AiCallRecord[] };

/**
 * The question as data and the answer as the person's text, for the model. The bank's own words go in as JSON with
 * every "<" escaped; in the answer, a tag that could close a block early is neutralised, as with a pasted posting.
 */
export function wrapPractice({ skillName, question, lookFor, answer }: FeedbackInput): string {
  const data = JSON.stringify({ skill: skillName, question, interviewersLookFor: lookFor }, null, 2).replace(/</g, "\\u003c");
  const text = answer.replace(/<(?=\s*\/?\s*(answer|practice)\b)/gi, "&lt;");
  return `<practice>\n${data}\n<answer>\n${text}\n</answer>\n</practice>`;
}

/** The model's feedback if it passes the schema, else null so the page says feedback isn't available. */
export function readFeedback(content: Anthropic.Beta.BetaContentBlock[]): PracticeFeedback | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = practiceFeedback.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });
  return defaultClient;
}

/**
 * Practice feedback (FR-22, prompts/practice-feedback): words on structure, specificity and correctness, and a stronger
 * sample answer. The model never scores. On any failure (an error, a refusal, output that fails the schema) the
 * feedback is null and the caller says so in plain words. inputRefs must hold ids only: the answer never reaches a log
 * or ai_calls. Never throws for a failed call.
 */
export async function practiceFeedbackFor(input: FeedbackInput, inputRefs: Record<string, string>, client: FeedbackClient = getClient()): Promise<FeedbackResult> {
  const prompt = loadPrompt("practice-feedback");
  // Reset at each attempt, so a logged latency is that attempt's own.
  let started = Date.now();
  const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean): AiCallRecord => ({
    purpose: "practice-feedback",
    model,
    promptVersion: prompt.id,
    inputRefs,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    costUsd: usage ? costUsd(model, usage) : 0,
    latencyMs: Date.now() - started,
    ok,
  });

  const failed: AiCallRecord[] = [];
  let response;
  try {
    response = await withOneRetry(
      (timeout) => {
        started = Date.now();
        return client.beta.messages.create(
          {
            model: PRACTICE_MODEL,
            max_tokens: 1_500,
            system: prompt.text,
            messages: [{ role: "user", content: wrapPractice(input) }],
            output_config: { effort: "low", format: betaZodOutputFormat(practiceFeedback) },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { timeout },
        );
      },
      {
        budgetMs: TIMEOUT_MS,
        minRetryMs: MIN_RETRY_MS,
        onError: (error, latencyMs) => {
          logEvent("error", "ai_call_failed", { purpose: "practice-feedback", ms: latencyMs, ...errorFields(error) });
          failed.push({ ...record(PRACTICE_MODEL, null, false), latencyMs });
        },
      },
    );
  } catch {
    return { feedback: null, calls: failed };
  }

  const feedback = response.stop_reason === "end_turn" ? readFeedback(response.content) : null;
  return { feedback, calls: [...failed, record(response.model, response.usage, feedback !== null)] };
}
