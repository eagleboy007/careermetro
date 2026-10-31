/**
 * Who handles complaints about messages and posts (India's IT Rules 2021). One value, so the real officer replaces the
 * placeholder in one place. Milin, 2026-10-11: a placeholder until the team exists. The real name and a working
 * mailbox must be in place before Inbox or Junction reach real users (pending item 15). Until then /grievances sits behind
 * the preview gate in src/proxy.ts with the signed-in screens; take it out of SIGNED_IN_PREFIXES when the officer is named.
 */
export const GRIEVANCE_OFFICER = {
  name: "Milin Shah",
  email: "grievance@careermetro.com",
  // Milin, 2026-10-31 (Junction decision 1): named, but still a placeholder until the mailbox works and the lawyer signs off.
  placeholder: true,
} as const;
