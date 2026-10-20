import { z } from "zod";
import { gapStatus } from "@/lib/schemas";
import dataAnalyst from "../../../fixtures/sample-resume/explanations.data-analyst.json";
import type { Explanations } from "./analysis";
import { SHOWN_GAPS } from "./analysis";
import { explainOutput } from "./explain";
import type { MatchResult } from "./match";

/*
 * Explanations for the sample resume (T113): it is a made-up person's, so it never uses the shared explanation budget
 * or calls the model. The roles the sample suggests have hand-written words checked in under fixtures/sample-resume, in
 * the explain-gaps output shape and under the same rules (quotes only from fixtures/resumes/priya-sharma.txt, the
 * matcher's hours, no exclamation marks). Any other role picked with the sample gets the template sentences.
 */
const BY_ROLE: Record<string, unknown> = { "data-analyst": dataAnalyst };

/**
 * A checked-in file: the explain-gaps output, plus what the matcher said when the words were written (each gap's state
 * and resume line, and the readiness numbers), so words written for one reading are never shown for another.
 */
export const sampleWords = explainOutput.extend({
  matched: z.object({ requiredMet: z.number().int(), requiredTotal: z.number().int(), estimatedHours: z.number().int() }),
  gaps: z.array(
    z.object({ skillId: z.string(), status: gapStatus, resumeQuote: z.string().nullable(), explanation: z.string().min(1).max(400) }),
  ),
});

/** The roles with checked-in words, for the fixture test. */
export const SAMPLE_EXPLAINED_ROLES = Object.keys(BY_ROLE);

/**
 * The checked-in words for this match, if they were written for exactly this reading: its shown gaps in order (as a
 * model answer must), each in the same state with the same resume line, and the same readiness numbers. Otherwise null,
 * and the caller uses the template sentences: a profile the person edited on the confirm step (Python taken out, say)
 * reads differently, and the words would no longer be true. Never calls the model.
 */
export function sampleExplanations(match: MatchResult): Explanations | null {
  const words = BY_ROLE[match.roleSlug];
  if (!words) return null;
  const parsed = sampleWords.safeParse(words);
  if (!parsed.success) return null;
  const { matched, gaps, readiness } = parsed.data;
  const shown = match.gaps.slice(0, SHOWN_GAPS);
  if (gaps.length !== shown.length) return null;
  const same = gaps.every(
    (g, i) => g.skillId === shown[i].skillId && g.status === shown[i].status && g.resumeQuote === shown[i].resumeQuote,
  );
  const r = match.readiness;
  if (!same || matched.requiredMet !== r.requiredMet || matched.requiredTotal !== r.requiredTotal || matched.estimatedHours !== r.estimatedHours) {
    return null;
  }
  return { readiness, bySkill: new Map(gaps.map((g) => [g.skillId, g.explanation])) };
}
