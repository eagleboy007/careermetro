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

/**
 * How a certificate is labelled (dev/profile-certs-plan.md): "verified" when its Credly badge matched, else "added"
 * (Added by you). Both fill the goal; the label only says how much it was checked.
 */
export const CERTIFICATE_LABELS = ["verified", "added"] as const;
export type CertificateLabel = (typeof CERTIFICATE_LABELS)[number];

export type CertificateOutcome =
  /** `proofId` is the accepted proof, so its Credly link can be checked once the transaction is done. */
  | { status: "filled"; label: CertificateLabel; skillId: string; proofId: string }
  | { status: "held"; skillId: string }
  | { status: "refused"; reason: CertificateRefusal };

/**
 * Why a Credly check left a certificate "Added by you" (gap_proofs.check_note). Only the owner sees the reason.
 * `unreachable` is the only one that isn't about the badge itself: Credly didn't answer in time.
 */
export const CREDLY_CHECK_NOTES = ["unreachable", "not_found", "not_public", "badge_name", "issuer", "earner_name", "no_name", "expired", "used_elsewhere"] as const;
export const credlyCheckNote = z.enum(CREDLY_CHECK_NOTES);
export type CredlyCheckNote = z.infer<typeof credlyCheckNote>;

const credlyIssuer = z
  .object({ entities: z.array(z.object({ entity: z.object({ name: z.string().max(300) }).loose() }).loose()).max(20).default([]) })
  .loose();

/**
 * The parts of Credly's public badge JSON (https://www.credly.com/badges/<id>.json) the check reads. Everything else
 * is ignored. Loose objects, so a field Credly adds later doesn't break the check; a field we need that is missing
 * fails it.
 */
export const credlyBadge = z
  .object({
    data: z
      .object({
        id: z.string().max(80),
        state: z.string().max(40),
        public: z.boolean().optional(),
        issued_to: z.string().max(300).nullish(),
        issued_to_first_name: z.string().max(150).nullish(),
        issued_to_last_name: z.string().max(150).nullish(),
        expires_at_date: z.string().max(40).nullish(),
        badge_template: z.object({ name: z.string().min(1).max(300), issuer: credlyIssuer.optional() }).loose(),
        issuer: credlyIssuer.optional(),
      })
      .loose(),
  })
  .loose();
export type CredlyBadge = z.infer<typeof credlyBadge>;

/** What the owner's "Check with Credly" gets back. */
export type CredlyCheckOutcome =
  | { status: "verified" }
  | { status: "added"; note: CredlyCheckNote }
  /** The badge is already verified on another account: held for review, so it fills nothing until then. */
  | { status: "held" }
  /** Nothing was checked: not their accepted proof, not a Credly badge link, or over the limit. */
  | { status: "refused"; reason: "not_found" | "not_credly" | "too_many" };
