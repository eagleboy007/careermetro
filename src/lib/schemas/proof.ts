import { z } from "zod";

/** A calendar date as an <input type="date"> sends it. */
const isoDate = z.iso.date();

/**
 * "Add a certificate" (dev/proof-plan.md): what the person sends to prove one goal. Evidence is a link here; the file
 * upload comes with private storage. The credential id is only ever kept as a keyed hash.
 */
export const certificateSubmission = z
  .object({
    goalId: z.uuid(),
    certId: z.string().min(1).max(80),
    credentialId: z.string().trim().min(3).max(120),
    issuedOn: isoDate,
    expiresOn: isoDate.nullable(),
    /** As printed on the certificate. Compared with the account name and then dropped, never stored. */
    nameOnCertificate: z.string().trim().min(1).max(120),
    url: z.url({ protocol: /^https$/ }).max(500),
    confirmed: z.literal(true),
  })
  .refine((s) => !s.expiresOn || s.expiresOn > s.issuedOn, { path: ["expiresOn"], message: "The expiry date must be after the issue date." });
export type CertificateSubmission = z.infer<typeof certificateSubmission>;

/** Why a certificate was not accepted. Each has its own plain message (src/lib/proofs/messages.ts). */
export const CERTIFICATE_REFUSALS = ["not_found", "unknown_cert", "not_covered", "expired", "issued_in_future", "name", "no_name", "link", "too_many"] as const;
export type CertificateRefusal = (typeof CERTIFICATE_REFUSALS)[number];

export type CertificateOutcome =
  | { status: "filled"; label: "verified" | "uploaded"; skillId: string }
  | { status: "held"; skillId: string }
  | { status: "refused"; reason: CertificateRefusal };
