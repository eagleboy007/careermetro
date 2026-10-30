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
   * True when a holder can have this certificate with no expiry date (T156; Data research's lifetime-check.tsv of
   * 2026-10-30): it never expires (ISTQB, PSM I, PSPO I, Microsoft Fundamentals, ECBA, OSCP, CRTO), or some versions
   * or earning dates never expire (PCEP, PCAP, MOS earned before 23 Sep 2025), or the issuer states no expiry (Google
   * and Meta professional certificates). Only these offer "It never expires" on Add a certificate; any other needs
   * its expiry date.
   */
  lifetime: z.literal(true).optional(),
  /** False while a batch awaits domain-expert review (docs/review/pack/certifications.csv). Left out on older entries. */
  reviewed: z.boolean().optional(),
});
export type Certification = z.infer<typeof certification>;
