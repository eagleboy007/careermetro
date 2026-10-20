import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { costUsd } from "@/lib/ai/cost";
import { withOneRetry } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import { errorFields, logEvent } from "@/lib/log";
import { PRACTICE_MODEL } from "@/lib/practice/feedback";
import { mockInterviewFeedback, type MockInterviewFeedback } from "@/lib/schemas";
import { feedbackShowable, matchFeedback } from "./interview";

/** The mock interview uses the same model as Practice feedback. */
export const MOCK_MODEL = PRACTICE_MODEL;
/** The person waits on this call after "End and get feedback": one retry inside this budget for an outage, else none. */
const TIMEOUT_MS = 40_000;
/** A retry starts only with at least this much of the budget left. */
const MIN_RETRY_MS = 8_000;

export type MockFeedbackClient = Pick<Anthropic, "beta">;

/** One answered question as the model gets it: the bank's words, and the person's answer. */
export type MockFeedbackItem = { position: number; topic: string; question: string; strongCovers: string; answer: string };
export type MockFeedbackInput = { roleTitle: string; items: MockFeedbackItem[] };
/** `feedback` is what the page shows; `parsed` is the model's output before the score check, for the eval. */
export type MockFeedbackResult = { feedback: MockInterviewFeedback | null; parsed: MockInterviewFeedback | null; calls: AiCallRecord[] };

/**
 * The questions as data and the answers as the person's text, for the model. The bank's own words go in as JSON with
 * every "<" escaped; in each answer, a tag that could close a block early is neutralised, as in Practice.
 */
export function wrapMockInterview({ roleTitle, items }: MockFeedbackInput): string {
  const data = JSON.stringify(
    { role: roleTitle, questions: items.map((i) => ({ position: i.position, topic: i.topic, question: i.question, aStrongAnswerCovers: i.strongCovers })) },
    null,
    2,
  ).replace(/</g, "\\u003c");
  const answers = items.map((i) => `<answer position="${i.position}">\n${i.answer.replace(/<(?=\s*\/?\s*(answer|mock_interview)\b)/gi, "&lt;")}\n</answer>`);
  return `<mock_interview>\n${data}\n${answers.join("\n")}\n</mock_interview>`;
}

/** The model's feedback if it passes the schema and covers exactly the answered positions; else null. */
export function parseMockFeedback(content: Anthropic.Beta.BetaContentBlock[], answered: readonly number[]): MockInterviewFeedback | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = mockInterviewFeedback.safeParse(raw);
  return parsed.success ? matchFeedback(parsed.data, answered) : null;
}

/** What the person may see: the parsed feedback unless it holds a score or "ready", which the page never shows. */
export function showableFeedback(parsed: MockInterviewFeedback | null): MockInterviewFeedback | null {
  if (!parsed) return null;
  if (feedbackShowable(parsed)) return parsed;
  // The reason only, never the words.
  logEvent("warn", "mock_feedback_dropped", { reason: "score_or_ready" });
  return null;
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });
  return defaultClient;
}

/**
 * Mock interview feedback (FR-50 part 3, prompts/mock-interview): one call for the whole session, with a summary in
 * words and, per answered question, what worked and what to add next time. The model never scores and never writes a
 * question. On any failure the feedback is null and the caller says so in plain words. inputRefs must hold ids only:
 * the answers never reach a log or ai_calls. Never throws for a failed call.
 */
export async function mockFeedbackFor(input: MockFeedbackInput, inputRefs: Record<string, string>, client: MockFeedbackClient = getClient()): Promise<MockFeedbackResult> {
  const prompt = loadPrompt("mock-interview");
  const answered = input.items.map((i) => i.position);
  let started = Date.now();
  const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean): AiCallRecord => ({
    purpose: "mock-interview",
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
            model: MOCK_MODEL,
            max_tokens: 2_500,
            system: prompt.text,
            messages: [{ role: "user", content: wrapMockInterview(input) }],
            output_config: { effort: "low", format: betaZodOutputFormat(mockInterviewFeedback) },
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
          logEvent("error", "ai_call_failed", { purpose: "mock-interview", ms: latencyMs, ...errorFields(error) });
          failed.push({ ...record(MOCK_MODEL, null, false), latencyMs });
        },
      },
    );
  } catch {
    return { feedback: null, parsed: null, calls: failed };
  }

  const parsed = response.stop_reason === "end_turn" ? parseMockFeedback(response.content, answered) : null;
  const feedback = showableFeedback(parsed);
  return { feedback, parsed, calls: [...failed, record(response.model, response.usage, feedback !== null)] };
}
