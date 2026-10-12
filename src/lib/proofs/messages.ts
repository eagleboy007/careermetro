import type { CertificateRefusal } from "@/lib/schemas";

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
