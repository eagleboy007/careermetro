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

/** The roles with checked-in words, for the fixture test. */
export const SAMPLE_EXPLAINED_ROLES = Object.keys(BY_ROLE);

/**
 * The checked-in words for this match, if they cover exactly its shown gaps in order (as a model answer must); else
 * null, and the caller uses the template sentences. Never calls the model.
 */
export function sampleExplanations(match: MatchResult): Explanations | null {
  const words = BY_ROLE[match.roleSlug];
  if (!words) return null;
  const parsed = explainOutput.safeParse(words);
  if (!parsed.success) return null;
  const expected = match.gaps.slice(0, SHOWN_GAPS).map((g) => g.skillId);
  const got = parsed.data.gaps.map((g) => g.skillId);
  if (got.length !== expected.length || got.some((id, i) => id !== expected[i])) return null;
  return { readiness: parsed.data.readiness, bySkill: new Map(parsed.data.gaps.map((g) => [g.skillId, g.explanation])) };
}
