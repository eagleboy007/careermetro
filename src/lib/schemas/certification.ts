import { z } from "zod";

/** A professional certification a role profile can recommend. Cost is null when we have not confirmed it. */
export const certification = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  issuer: z.string().min(1),
  level: z.enum(["entry", "associate", "professional", "specialty", "advanced", "expert"]),
  cost: z.enum(["free", "paid"]).nullable(),
  aliases: z.array(z.string().min(1)),
});
export type Certification = z.infer<typeof certification>;
