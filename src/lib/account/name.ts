/** Shown when someone has not given a name. Never a part of their email. */
export const NO_NAME = "CareerMetro member";

/** The name to show for an account: the one they gave, else NO_NAME. The email is never used, not even its first part. */
export const displayName = (name: string | null | undefined): string => name?.trim() || NO_NAME;

/** The first name for a greeting, or "" when there is none, so the greeting reads "Hi." rather than an email or a stand-in. */
export const firstName = (name: string | null | undefined): string => name?.trim().split(/\s+/)[0] ?? "";

/** The full name from first and last name, single-spaced. "" when both are empty. */
export const fullName = (first: string | null | undefined, last: string | null | undefined): string =>
  [first, last].map((part) => part?.trim().replace(/\s+/g, " ") ?? "").filter(Boolean).join(" ");

/**
 * First and last name for an account saved before they were asked for separately: the first word, then the rest.
 * Only a starting point for the settings form; the person corrects it there.
 */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return { first: words[0] ?? "", last: words.slice(1).join(" ") };
}

/** The name to print on the person's resume download: first and last name, else the older single name, else none. */
export function resumeName(account: { name: string | null; firstName: string | null; lastName: string | null } | null): string | null {
  if (!account) return null;
  return fullName(account.firstName, account.lastName) || account.name?.trim() || null;
}
