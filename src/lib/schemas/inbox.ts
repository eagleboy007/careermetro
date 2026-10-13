import { z } from "zod";

/**
 * Inbox, part 1 (handoff 12b; dev/inbox-plan.md, approved by Milin 2026-10-11). Chats between two people, or between a
 * person and a company about one application. Message text is personal data: it never goes into logs or analytics.
 */
export const CONVERSATION_KINDS = ["application", "direct"] as const;
/** A direct chat with someone who isn't a connection starts as a `request`: one message, then nothing until accepted. */
export const CONVERSATION_STATUSES = ["request", "open", "closed"] as const;
/** Company team members and interviewers come with the employer side; interviewers can read but never send. */
export const MEMBER_ROLES = ["member", "company_team", "interviewer_read_only"] as const;
/** `ask_times` and `ask_question` are a company's cards (part 2); `system` lines hold a code, never free text. */
export const MESSAGE_KINDS = ["text", "ask_times", "ask_question", "system"] as const;
/** `job` is a job posted on CareerMetro (Corporate build step 3), reported from Departures. */
export const REPORT_TARGETS = ["message", "person", "chat", "job"] as const;
/** What the Inbox's Report panel can report. */
export const CHAT_REPORT_TARGETS = ["message", "person", "chat"] as const;
export const REPORT_REASONS = ["money_or_otp", "harassment", "intimate_or_impersonation", "fake_or_spam", "other"] as const;
export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
/**
 * What a `system` message's body may say. Shown as words by the Inbox, so the stored line never holds personal data.
 * `applied` is the first line of an application chat (corporate build step 5).
 */
export const SYSTEM_CODES = ["accepted", "applied"] as const;

export const MESSAGE_MAX_CHARS = 2000;
export const REPORT_NOTE_MAX_CHARS = 500;

export type ConversationKind = (typeof CONVERSATION_KINDS)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const messageBody = z
  .string()
  .trim()
  .min(1, { error: "Write a message first." })
  .max(MESSAGE_MAX_CHARS, { error: `Keep it under ${MESSAGE_MAX_CHARS.toLocaleString("en-IN")} characters.` });

export const sendMessageInput = z.object({ conversationId: z.uuid(), body: messageBody });
export const conversationInput = z.object({ conversationId: z.uuid() });

export const reportInput = z
  .object({
    conversationId: z.uuid(),
    target: z.enum(CHAT_REPORT_TARGETS),
    /** Set when the report is about one message. */
    messageId: z.uuid().optional(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().trim().max(REPORT_NOTE_MAX_CHARS).optional(),
    /** Block the other person too. */
    block: z.boolean().default(false),
  })
  .refine((r) => (r.target === "message") === (r.messageId !== undefined), { error: "A message report names the message.", path: ["messageId"] });
export type ReportInput = z.input<typeof reportInput>;

const HOUR = 60 * 60 * 1000;

/**
 * The deadlines for a report under India's IT Rules 2021 (rule 3(2), as amended in 2022): acknowledged within 24 hours;
 * sexual content or impersonation (morphed images included) acted on within 24 hours; anything asking for content to
 * come down within 72 hours; other complaints decided within 15 days.
 */
export function reportDeadlines(reason: ReportReason, createdAt: Date) {
  const within = reason === "intimate_or_impersonation" ? 24 * HOUR : reason === "other" ? 15 * 24 * HOUR : 72 * HOUR;
  return { acknowledgeBy: new Date(createdAt.getTime() + 24 * HOUR), resolveBy: new Date(createdAt.getTime() + within) };
}
