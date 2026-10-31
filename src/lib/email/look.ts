/*
 * The look the app's own emails share (the weekly My jobs email, the Monday events digest): light-mode token values from
 * src/app/globals.css, written inline because email clients ignore CSS variables. Ink links, never cobalt: cobalt means
 * progress only, and an email is not progress.
 */

/** Light-mode token values (src/app/globals.css). */
export const EMAIL_TOKENS = { bg: "#f4f5f8", surface: "#ffffff", surface2: "#eceff4", ink: "#12151c", muted: "#586072", line: "#dce0e8" } as const;

/** Escapes text for HTML: &, <, >, quotes. */
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
