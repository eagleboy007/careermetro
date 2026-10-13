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
  used_elsewhere: "This badge is already verified on another account.",
};

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
};
