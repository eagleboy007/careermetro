import { z } from "zod";

/**
 * A free learning resource in the reviewed catalog (FR-17). Paths link only to these; the model never writes a URL.
 * The URL is the identity: the seed upserts by it, and the database gives each one its own uuid.
 */
export const resource = z.object({
  title: z.string().min(1).max(160),
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "must be https"),
  provider: z.string().min(1).max(60),
  kind: z.enum(["course", "docs", "video", "practice"]),
  skillIds: z.array(z.string().min(1)).min(1),
  minutes: z.number().int().positive().max(6000),
  free: z.boolean().default(true),
});
export type Resource = z.infer<typeof resource>;

/** A fallback proof-of-skill task per skill, used when the model is not available. */
export const proofTask = z.object({
  skillId: z.string().min(1),
  task: z.string().min(20).max(300),
});
export type ProofTask = z.infer<typeof proofTask>;
