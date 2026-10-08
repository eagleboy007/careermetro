import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { costUsd } from "@/lib/ai/cost";
import { describeAiError } from "@/lib/ai/errors";
import type { AiCallRecord } from "@/lib/ai/log";
import { loadPrompt } from "@/lib/ai/prompts";
import { plannedPath, type PlannedPath } from "@/lib/schemas";

export const WRITE_PATH_MODEL = "claude-opus-5-5";
/** The Path page waits on this call, so it gets one short attempt and the template covers any failure. */
const TIMEOUT_MS = 20_000;

export type WriteClient = Pick<Anthropic, "beta">;
export type ResourceTitles = ReadonlyMap<string, { title: string; provider: string }>;

/** What the model must return: a reason and a proof task per step, in the given order. */
export const writePathOutput = z.object({
  steps: z.array(z.object({ skillId: z.string(), reason: z.string().min(1).max(400), proofTask: z.string().min(1).max(400) })),
});

export type WritePathResult = { path: PlannedPath; source: "model" | "template"; calls: AiCallRecord[] };

const LINK = /https?:\/\/|www\.|\.(com|org|in|io)\b/i;

/** The fixed steps as data for the model: titles of the chosen resources, never their URLs (FR-17). */
export function wrapPath(plan: PlannedPath, roleTitle: string, titles: ResourceTitles): string {
  const data = {
    role: roleTitle,
    weeklyHours: plan.weeklyHours,
    steps: plan.steps.map((s) => ({
      skillId: s.skillId,
      skill: s.skillName,
      status: s.status,
      hours: s.hours,
      startsInWeek: s.week,
      gap: s.reason,
      resources: s.resourceIds.flatMap((id) => {
        const r = titles.get(id);
        return r ? [`${r.title} (${r.provider})`] : [];
      }),
    })),
  };
  // Every "<" becomes a JSON escape, so no text inside the data can close the block; the JSON still parses.
  const json = JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
  return `<path>\n${json}\n</path>`;
}

/** The plan with the model's wording if it covers exactly the same steps in order and writes no link, else null. */
export function readWording(content: Anthropic.Beta.BetaContentBlock[], plan: PlannedPath): PlannedPath | null {
  const text = content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  let parsed;
  try {
    parsed = writePathOutput.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const got = parsed.data.steps;
  if (got.length !== plan.steps.length || got.some((s, i) => s.skillId !== plan.steps[i].skillId)) return null;
  if (got.some((s) => LINK.test(s.reason) || LINK.test(s.proofTask))) return null;
  const result = plannedPath.safeParse({
    ...plan,
    steps: plan.steps.map((s, i) => ({ ...s, reason: got[i].reason, proofTask: got[i].proofTask })),
  });
  return result.success ? result.data : null;
}

let defaultClient: Anthropic | undefined;
function getClient(): Anthropic {
  defaultClient ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 });
  return defaultClient;
}

/**
 * Asks the model to word the steps the path builder already decided (FR-16). Any answer that adds, drops or reorders
 * a step, or writes a link, is discarded and the template wording stays, so the Path page never depends on the model.
 * inputRefs must hold ids only. Never throws for a failed call.
 */
export async function writePath(
  plan: PlannedPath,
  roleTitle: string,
  titles: ResourceTitles,
  inputRefs: Record<string, string>,
  client: WriteClient = getClient(),
): Promise<WritePathResult> {
  const prompt = loadPrompt("write-path");
  const started = Date.now();
  const record = (model: string, usage: Parameters<typeof costUsd>[1] | null, ok: boolean): AiCallRecord[] => [
    {
      purpose: "write-path",
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
        model: WRITE_PATH_MODEL,
        max_tokens: 3_000,
        system: prompt.text,
        messages: [{ role: "user", content: wrapPath(plan, roleTitle, titles) }],
        output_config: { effort: "low", format: betaZodOutputFormat(writePathOutput) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { timeout: TIMEOUT_MS },
    );
  } catch (error) {
    console.error("write-path call failed:", describeAiError(error));
    return { path: plan, source: "template", calls: record(WRITE_PATH_MODEL, null, false) };
  }

  const worded = response.stop_reason === "end_turn" ? readWording(response.content, plan) : null;
  const calls = record(response.model, response.usage, worded !== null);
  return worded ? { path: worded, source: "model", calls } : { path: plan, source: "template", calls };
}
