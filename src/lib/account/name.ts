/** Shown when someone has not given a name. Never a part of their email. */
export const NO_NAME = "CareerMetro member";

/** The name to show for an account: the one they gave, else NO_NAME. The email is never used, not even its first part. */
export const displayName = (name: string | null | undefined): string => name?.trim() || NO_NAME;

/** The first name for a greeting, or "" when there is none, so the greeting reads "Hi." rather than an email or a stand-in. */
export const firstName = (name: string | null | undefined): string => name?.trim().split(/\s+/)[0] ?? "";
