import type { CertificateLabel } from "@/lib/schemas";

/**
 * What the Add a certificate form shows after saving (src/app/(app)/today/actions.ts). `label` says how it was checked:
 * "verified" (Verified with Credly) or "added" (Added by you), with `note` saying why a Credly check didn't verify it.
 */
export type CertificateResult =
  | { status: "filled"; label: CertificateLabel; note?: string }
  /**
   * "saved": kept but not filling the goal yet: a Credly badge waiting for its check (check pending), or one Credly
   * shows as expired (the goal reads Renew).
   */
  | { status: "held" | "refused" | "saved"; message: string }
  /** `field` is the input the message is about, so the form can mark and focus it. */
  | { status: "invalid"; message: string; field?: string };

/** What the form sends. The server checks every field again. */
export type CertificateInput = {
  goalId: string;
  certId: string;
  credentialId: string;
  issuedOn: string;
  expiresOn: string | null;
  nameOnCertificate: string;
  url: string;
  confirmed: boolean;
};

/** What "Check with Credly" on the profile says back (src/app/(app)/me/actions.ts). */
export type CredlyCheckResult = { status: "verified" | "added" | "pending" | "held" | "refused"; message: string };
