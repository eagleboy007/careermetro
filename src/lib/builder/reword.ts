import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { roleProfiles } from "@/content";
import { costUsd } from "@/lib/ai/cost";
import { withOneRetry } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import { errorFields, logEvent } from "@/lib/log";
import { builderReword, type BuilderAnswers, type BuilderReword } from "@/lib/schemas";

export const BUILD_MODEL = "claude-opus-5-5";
/** The person waits on "Check my gaps": one retry inside this budget, else their own words are used. */
const TIMEOUT_MS = 30_000;
const MIN_RETRY_MS = 8_000;

export type RewordClient = Pick<Anthropic, "beta">;
export type RewordResult = { reword: BuilderReword | null; calls: AiCallRecord[] };

const roleTitle = new Map(roleProfiles.map((r) => [r.slug, r.title]));

/**
 * The answers as data for the model (prompts/build-resume): the free-text answers with their ids and headings, the
 * picked tools and the target role. Never contact details, the name or the city. Every "<" is escaped, so nothing in
 * an answer can close the block.
 */
export function wrapAnswers(a: BuilderAnswers): string {
  const answers = [
    ...(a.worked ? a.jobs : []).filter((j) => j.did).map((j) => ({ id: `j:${j.id}`, heading: [j.title, j.company].filter(Boolean).join(", "), current: j.to === "now", text: j.did })),
    ...a.projects.filter((p) => p.did).map((p) => ({ id: `p:${p.id}`, heading: p.name, current: false, text: p.did })),
  ];
  const data = { targetRole: a.role.roleSlug ? (roleTitle.get(a.role.roleSlug) ?? null) : null, tools: a.tools, answers };
  return `<answers>\n${JSON.stringify(data, null, 2).replace(/</g, "\\u003c")}\n</answers>`;
}

/** The model's reply if it passes the schema, else null (the person's own words are used). */
export function readReword(content: Anthropic.Beta.BetaContentBlock[]): BuilderReword | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  try {
    const parsed = builderReword.safeParse(JSON.parse(text));
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
 * Rewords the free-text answers (FR-36, plan section 3 step 2). Never throws for a failed call: on an error, a refusal
 * or output that fails the schema the reword is null and the builder uses the person's own sentences. inputRefs holds
 * ids only; the answers never reach a log or ai_calls.
 */
export async function rewordAnswers(a: BuilderAnswers, inputRefs: Record<string, string>, client: RewordClient = getClient()): Promise<RewordResult> {
  const prompt = loadPrompt("build-resume");
  let started = Date.now();
  const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean): AiCallRecord => ({
    purpose: "build-resume",
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
            model: BUILD_MODEL,
            max_tokens: 4_000,
            system: prompt.text,
            messages: [{ role: "user", content: wrapAnswers(a) }],
            output_config: { effort: "low", format: betaZodOutputFormat(builderReword) },
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
          logEvent("error", "ai_call_failed", { purpose: "build-resume", ms: latencyMs, ...errorFields(error) });
          failed.push({ ...record(BUILD_MODEL, null, false), latencyMs });
        },
      },
    );
  } catch {
    return { reword: null, calls: failed };
  }
  const reword = response.stop_reason === "end_turn" ? readReword(response.content) : null;
  return { reword, calls: [...failed, record(response.model, response.usage, reword !== null)] };
}
