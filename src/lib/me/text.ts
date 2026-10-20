import { hasContactDetails } from "@/lib/account/username";

/*
 * Plain text rules for what a person adds on Me (docs/plans/me-editing-plan.md): shared by the forms, for instant
 * feedback, and the Zod schemas, which check again on the server. No Zod here, so client components can import it.
 * Nothing here logs what it is given.
 */

/** One line, single-spaced, trimmed. */
export const oneLine = (raw: string): string => raw.replace(/\s+/g, " ").trim();

/** A story part: line breaks kept (at most one blank line in a row), spaces in a line collapsed, trimmed. */
export const storyText = (raw: string): string =>
  raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** An interest as compared: lowercase, trimmed, single spaces. "Public  Speaking " and "public speaking" are one. */
export const interestKey = (raw: string): string => oneLine(raw).toLowerCase();

/**
 * A web link: a scheme, "www.", or a name on a common top-level domain ("bit.ly", "wa.me", "priya.in/cv"). The
 * domain must be lowercase, so a sentence run together ("Pune.In 2023", "for.Me") is not a link. Tech names with a dot
 * ("Node.js", "ASP.NET", "Vue.js") are not links either: .js and .net are left off on purpose.
 */
const SCHEME_LINK = /\bhttps?:\/\/|\bwww\./i;
const DOMAIN_LINK = /\b[A-Za-z0-9-]+\.(?:com|in|org|io|me|ly|link|xyz|site|online|co|info|app|dev|gg|to)\b/;

/**
 * Whether text carries a link. `domains: false` skips the bare-domain check, for a company or institution whose name
 * is a domain ("Booking.com", "Amazon.in"); a scheme or "www." is still a link there.
 */
export const hasLink = (text: string, { domains = true }: { domains?: boolean } = {}): boolean =>
  SCHEME_LINK.test(text) || (domains && DOMAIN_LINK.test(text));

/** Whether text others read carries an email address, a phone number or a link (plan choice 8). */
export const hasContactOrLink = (text: string, opts?: { domains?: boolean }): boolean => hasContactDetails(text) || hasLink(text, opts);

/** "2024-06": a year and month as the month fields send them. */
export const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
