import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { costUsd } from "@/lib/ai/cost";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import type { GapAnalysis } from "@/lib/schemas";
import { buildGapAnalysis, SHOWN_GAPS, type Explanations } from "./analysis";
import type { MatchResult } from "./match";

export const EXPLAIN_MODEL = "claude-opus-5-5";
/** The Gaps page waits on this call, so it gets one short attempt and the template covers any failure. */
const TIMEOUT_MS = 30_000;

export type ExplainClient = Pick<Anthropic, "beta">;

/** What the model must return: one explanation per gap, in the given order, plus a readiness line. */
export const explainOutput = z.object({
  readiness: z.string().min(1).max(400),
  gaps: z.array(z.object({ skillId: z.string(), explanation: z.string().min(1).max(400) })),
});

export type ExplainResult = { analysis: GapAnalysis; source: "model" | "template"; calls: AiCallRecord[] };

/** The decided gaps as data for the model. Closing tags inside resume quotes can't end the block early. */
export function wrapAnalysis(match: MatchResult, roleTitle: string): string {
  const data = {
    role: roleTitle,
    requiredSkills: match.readiness.requiredTotal,
    skillsCovered: match.readiness.requiredMet,
    estimatedHours: match.readiness.estimatedHours,
    gaps: match.gaps.slice(0, SHOWN_GAPS).map((g) => ({
      skillId: g.skillId,
      skill: g.skillName,
      status: g.status,
      resumeQuote: g.resumeQuote,
      roleExpects: g.requirement,
    })),
  };
  const json = JSON.stringify(data, null, 2).replace(/<\/?analysis>/gi, (tag) => tag.replace("<", "&lt;").replace(">", "&gt;"));
  return `<analysis>\n${json}\n</analysis>`;
}

/** The model's explanations if they cover exactly the given gaps in order, else null so the template is used. */
export function readExplanations(content: Anthropic.Beta.BetaContentBlock[], match: MatchResult): Explanations | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  let parsed;
  try {
    parsed = explainOutput.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const expected = match.gaps.slice(0, SHOWN_GAPS).map((g) => g.skillId);
  const got = parsed.data.gaps.map((g) => g.skillId);
  if (got.length !== expected.length || got.some((id, i) => id !== expected[i])) return null;
  return { readiness: parsed.data.readiness, bySkill: new Map(parsed.data.gaps.map((g) => [g.skillId, g.explanation])) };
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });
  return defaultClient;
}

/**
 * AI-2: asks the model to explain gaps the matcher already decided. The model can't change which gaps are shown:
 * any answer that adds, drops or reorders one is discarded. On any failure the page uses template sentences,
 * so it never depends on the model. inputRefs must hold ids only. Never throws for a failed call.
 */
export async function explainGaps(
  match: MatchResult,
  roleTitle: string,
  inputRefs: Record<string, string>,
  client: ExplainClient = getClient(),
): Promise<ExplainResult> {
  const template = (calls: AiCallRecord[]): ExplainResult => ({ analysis: buildGapAnalysis(match, null), source: "template", calls });
  if (match.gaps.length === 0) return template([]);

  const prompt = loadPrompt("explain-gaps");
  const started = Date.now();
  const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean): AiCallRecord[] => [
    {
      purpose: "explain-gaps",
      model,
      promptVersion: prompt.id,
      inputRefs,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      costUsd: usage ? costUsd(model, usage) : 0,
      latencyMs: Date.now() - started,
      ok,
    },
  ];

  let response;
  try {
    response = await client.beta.messages.create(
      {
        model: EXPLAIN_MODEL,
        max_tokens: 2_000,
        system: prompt.text,
        messages: [{ role: "user", content: wrapAnalysis(match, roleTitle) }],
        output_config: { effort: "low", format: betaZodOutputFormat(explainOutput) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (error) {
    console.error("explain-gaps call failed:", error instanceof Error ? error.name : typeof error);
    return template(record(EXPLAIN_MODEL, null, false));
  }

  const explanations = response.stop_reason === "end_turn" ? readExplanations(response.content, match) : null;
  const calls = record(response.model, response.usage, explanations !== null);
  if (!explanations) return template(calls);
  return { analysis: buildGapAnalysis(match, explanations), source: "model", calls };
}
