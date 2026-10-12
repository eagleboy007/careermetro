import { z } from "zod";
import { gapStatus } from "./gap";

/**
 * One labelled case in the AI evaluation set (AI-4). Resumes are synthetic. Labels say what a correct
 * pipeline should find, so parse accuracy, gap precision/recall and hallucinations can be scored.
 */
export const evalCase = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  roleSlug: z.string().min(1),
  /** One line describing who this candidate is, for humans reading the set. */
  persona: z.string().min(1),
  resumeText: z.string().min(200),
  expected: z.object({
    totalYearsExperience: z.number().nonnegative(),
    /** Skills a correct parser must find, each with a verbatim quote from the resume as evidence. */
    skills: z.array(z.object({ skillId: z.string().min(1), quote: z.string().min(1) })).min(1),
    /** The expected status of every required skill of the role that is not fully met. */
    gaps: z.array(z.object({ skillId: z.string().min(1), status: gapStatus.exclude(["met"]) })),
    /** Skills the resume gives no evidence for; claiming them counts as a hallucination. */
    mustNotClaim: z.array(z.string().min(1)).min(1),
  }),
  reviewedBy: z.string().nullable(),
});
export type EvalCase = z.infer<typeof evalCase>;

/**
 * One labelled synthetic job posting for the parse-jd eval (fixtures/evals/jd). Labels say which of our skills a correct
 * reading finds, required or good to have, after the plain-code quote check and mapping.
 */
export const jdEvalCase = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  company: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(200).max(12_000),
  expected: z.object({
    /** Skill ids the posting asks for as requirements. */
    required: z.array(z.string().min(1)).min(1),
    /** Skill ids the posting calls good to have. */
    nice: z.array(z.string().min(1)),
    /** Names the posting asks for that our skill list doesn't have; a correct reading lists them as unknown. */
    unknown: z.array(z.string().min(1)),
    /** Skill ids the posting never names; finding them counts as a hallucination. */
    mustNotClaim: z.array(z.string().min(1)).min(1),
  }),
  reviewedBy: z.string().nullable(),
});
export type JdEvalCase = z.infer<typeof jdEvalCase>;
