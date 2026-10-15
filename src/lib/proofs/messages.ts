import type { CertificateRefusal, CredlyCheckNote, CredlyCheckOutcome } from "@/lib/schemas";

/**
 * Why a Credly check left a certificate "Added by you" (dev/profile-certs-plan.md). Only the owner reads these, on their
 * profile and after saving the form. They never say whose name the badge shows.
 */
export const CREDLY_NOTE_MESSAGES: Record<CredlyCheckNote, string> = {
  unreachable: "Credly didn't answer, so we couldn't check the badge. Try again later.",
  not_found: "Credly has no badge at this link. Check the link from your Credly badge page.",
  not_public: "The badge isn't public on Credly, or it was taken back. Make it public on Credly, then check again.",
  badge_name: "The Credly badge is for a different certificate.",
  issuer: "The Credly badge is from a different issuer.",
  earner_name: "The name on the Credly badge doesn't match your account.",
  no_name: "Add your name to your account first, then check again.",
  expired: "Credly shows this badge as expired.",
  used_elsewhere: "This badge is already on another account, so we'll review it.",
};

/** A Credly badge already on another account: held for review, like a reused credential. */
export const CREDLY_HELD_MESSAGE = "This Credly badge is already on another account, so we'll review it. The certificate doesn't fill the goal until then.";

/** A credential another account already used: held for review. */
export const CREDENTIAL_HELD_MESSAGE = "This certificate is already on another account, so we'll check it first. It doesn't fill the goal until then.";

/** A Credly badge saved but not yet confirmed by Credly (decision of 2026-10-13). Only its owner sees it. */
export const CREDLY_PENDING_MESSAGE = "Saved as Added by you, check pending. It fills the goal once Credly confirms the badge; until then only you see it.";

/** Credly shows the badge as expired: the certificate is kept with Credly's date, and its goal reads Renew. */
export const CREDLY_EXPIRED_MESSAGE = "Credly shows this badge as expired, so the goal moves to Renew. Add the renewed certificate when you have it.";

/** Why "Check with Credly" checked nothing. */
export const CREDLY_REFUSAL_MESSAGES: Record<Extract<CredlyCheckOutcome, { status: "refused" }>["reason"], string> = {
  not_found: "We couldn't find this certificate. Reload the page and try again.",
  not_credly: "Only Credly badge links can be checked.",
  too_many: "You've checked a lot of badges today. Please try again tomorrow.",
};

/** What the person reads when a certificate isn't accepted, with what to do next. Never says whose name it shows. */
export const CERTIFICATE_REFUSAL_MESSAGES: Record<CertificateRefusal, string> = {
  not_found: "We couldn't find this goal. Reload the page and try again.",
  unknown_cert: "Pick the certificate from the list.",
  not_covered: "This certificate doesn't cover this skill. Pick one from the list for this goal.",
  expired: "This certificate has expired. Add a current one, or renew it first.",
  issued_in_future: "The issue date is in the future. Check the date on the certificate.",
  name: "The name on this certificate doesn't match your account. Use a certificate in your name, or ask us to correct your name from the Grievances page.",
  no_name: "Please add your name to your account first, then add the certificate.",
  link: "Use the verify link from the issuer or from Credly. Other links can't be checked.",
  too_many: "You've added a lot of certificates today. Please try again tomorrow.",
  reviewed:
    "We reviewed this certificate and couldn't confirm it for your account, so it can't be added again. If you think that's wrong, tell us from the Grievances page.",
};

/**
 * On a goal whose certificate was rejected after review (/admin/proofs, FR-44): it couldn't be confirmed for this
 * person, and how to raise it. Never says who else holds it. The Grievances link follows these words.
 */
export const CERTIFICATE_NOT_CONFIRMED_MESSAGE =
  "We reviewed your certificate for this goal and couldn't confirm it is yours, so it doesn't fill the gap. If it is yours, raise it with us from the Grievances page and we'll look again.";
