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
 * A web link: a scheme, "www.", or a name on a common top-level domain ("bit.ly", "wa.me", "priya.in/cv"). Tech names
 * with a dot ("Node.js", "ASP.NET", "Vue.js") are not links: .js and .net are left off on purpose.
 */
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|in|org|io|me|ly|link|xyz|site|online|co|info|app|dev|gg|to)\b/i;

export const hasLink = (text: string): boolean => LINK.test(text);

/** Whether text others read carries an email address, a phone number or a link (plan choice 8). */
export const hasContactOrLink = (text: string): boolean => hasContactDetails(text) || hasLink(text);

/** "2024-06": a year and month as the month fields send them. */
export const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
