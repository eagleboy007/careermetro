import { HEADLINE_MAX, PAY_MAX_LAKH, USERNAME_MAX, USERNAME_MIN } from "@/lib/schemas/constants";

/**
 * Usernames, headlines and pay as typed (dev/account-settings-plan.md, part 2). Plain code shared by the settings
 * form, for instant feedback, and the server, which checks again. Nothing here logs what it is given.
 */

/**
 * Words nobody can take: our own routes and pages, now and planned, and staff, brand and official-sounding words.
 * Compared after lowercasing, with hyphens kept ("help-desk" is fine, "help" is not).
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Routes and pages.
  "about", "account", "accounts", "admin", "api", "app", "arrivals", "auth", "blog", "careers", "changelog", "community",
  "contact", "corporate", "dashboard", "departures", "design", "docs", "download", "edit", "explore", "faq", "grievance",
  "grievances", "help", "home", "inbox", "jobs", "junction", "legal", "library", "login", "logout", "map", "market", "me",
  "messages", "network", "new", "news", "notifications", "pricing", "privacy", "profile", "profiles", "register", "resume",
  "resumes", "roles", "search", "security", "settings", "sign-in", "sign-out", "sign-up", "signin", "signout", "signup",
  "start", "status", "terms", "timetable", "today", "user", "users", "www",
  // Staff, brand and official-sounding words.
  "abuse", "billing", "elite", "example", "grievance-officer", "info", "mail", "moderator", "null", "official", "owner",
  "postmaster", "recruiter", "root", "staff", "support", "system", "team", "test", "undefined", "webmaster",
]);

export type UsernameProblem = "short" | "long" | "chars" | "hyphen" | "reserved" | "phone";

export const USERNAME_MESSAGES: Record<UsernameProblem, string> = {
  short: `At least ${USERNAME_MIN} characters.`,
  long: `At most ${USERNAME_MAX} characters.`,
  chars: "Use lowercase letters, numbers and hyphens only.",
  hyphen: "Start and end with a letter or number, with one hyphen at a time.",
  reserved: "That one is reserved. Try another.",
  phone: "A username can't hold a phone number. Try another.",
};

/** As stored and compared: trimmed and lowercase. */
export const normalUsername = (raw: string): string => raw.trim().toLowerCase();

/** Ten or more digits, allowing spaces, dots, hyphens and brackets between them: reads as a phone number. */
const PHONE = /(?:\d[\s().-]*){9}\d/;

/** What is wrong with a username already normalised, or null when it can be used. Taken or not is the server's call. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < USERNAME_MIN) return "short";
  if (name.length > USERNAME_MAX) return "long";
  if (!/^[a-z0-9-]+$/.test(name)) return "chars";
  if (/^-|-$|--/.test(name)) return "hyphen";
  if (PHONE.test(name)) return "phone";
  if (RESERVED_USERNAMES.has(name) || name.includes("careermetro")) return "reserved";
  return null;
}

export type HeadlineProblem = "long" | "contact";

export const HEADLINE_MESSAGES: Record<HeadlineProblem, string> = {
  long: `At most ${HEADLINE_MAX} characters.`,
  contact: "Leave out email addresses and phone numbers. They are never shown on your profile.",
};

/** One line, single-spaced. "" when empty. */
export const cleanHeadline = (raw: string): string => raw.replace(/\s+/g, " ").trim();

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** What is wrong with a cleaned headline, or null. Other people read it, so it must not carry contact details. */
export function headlineProblem(text: string): HeadlineProblem | null {
  if (text.length > HEADLINE_MAX) return "long";
  if (EMAIL.test(text) || PHONE.test(text)) return "contact";
  return null;
}

export const PAY_MESSAGE = `Enter lakh a year as a number, like 4.5 (up to ${PAY_MAX_LAKH}).`;

/**
 * Pay as typed, in lakh a year ("4.2", "12", "6.50"), as a number with at most two decimals. null when empty;
 * undefined when it isn't one we keep (more decimals, under 0.1, over PAY_MAX_LAKH, or not a plain number).
 */
export function parseLakh(raw: string): number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  if (!/^(?:\d{1,3}(?:\.\d{1,2})?|\.\d{1,2})$/.test(s)) return undefined;
  const n = Number(s);
  if (!(n >= 0.1 && n <= PAY_MAX_LAKH)) return undefined;
  return Math.round(n * 100) / 100;
}

/** How pay is shown back in the form: "4.2", "6", never "6.00". */
export const lakhText = (n: number | null): string => (n === null ? "" : String(Number(n.toFixed(2))));
