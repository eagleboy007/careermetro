import { z } from "zod";

/** A professional certification a role profile can recommend. Cost is null when we have not confirmed it. */
export const certification = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  issuer: z.string().min(1),
  level: z.enum(["entry", "associate", "professional", "specialty", "advanced", "expert"]),
  cost: z.enum(["free", "paid"]).nullable(),
  aliases: z.array(z.string().min(1)),
  /** Skills that holding the certification shows (met), and skills it only touches (weak). Never fills a goal on its own. */
  proves: z.array(z.string()).default([]),
  partial: z.array(z.string()).default([]),
  /**
   * True only for a certificate that never expires and needs no renewal (T156): ISTQB, Python Institute's PCEP and PCAP,
   * Microsoft Office Specialist, Scrum.org's PSM I and PSPO I, Tableau Desktop Specialist and Coursera professional
   * certificates. Only these offer "It never expires" on Add a certificate; any other needs its expiry date.
   */
  lifetime: z.literal(true).optional(),
  /** False while a batch awaits domain-expert review (docs/review/pack/certifications.csv). Left out on older entries. */
  reviewed: z.boolean().optional(),
});
export type Certification = z.infer<typeof certification>;
