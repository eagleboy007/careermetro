import type { ReportReason } from "@/lib/schemas/inbox";

export type InboxKind = "application" | "person" | "request";
export type InboxFilter = "all" | InboxKind;

export type InboxMessage = {
  /** Real messages carry their id, so one can be reported. */
  id?: string;
  by: "me" | "them" | "system";
  /** For a company's message, the person at the company who wrote it. */
  who?: string;
  type?: "text" | "times" | "question";
  text: string;
  at?: string;
  /** A real "Ask for times" card (corporate build step 6). The example Inbox has none and uses its own grid. */
  ask?: InboxAsk;
};

/**
 * "Ask for times" as the candidate sees it: the days asked, the picker's times, the times too soon to offer now, and
 * what they offered once they have. Every label is worked out on the server, in India time.
 */
export type InboxAsk = {
  messageId: string;
  days: { day: string; label: [string, string] }[];
  times: string[];
  /** Slot keys ("2026-10-14T11:00") that can't be offered now: past, or less than two hours ahead. */
  unavailable: string[];
  /** The times offered in answer, as labels, or null while unanswered. */
  offered: string[] | null;
  /** The candidate can still answer. */
  open: boolean;
};

export type InboxThread = {
  id: string;
  kind: InboxKind;
  /** The company for an application, otherwise the person. */
  name: string;
  /** Application chats: the job applied for. */
  job?: string;
  /** Application chats: the company is verified now. The badge shows only then; the anti-scam line always. */
  verified?: boolean;
  /** People and requests: the status they set (Working at X, Studying and so on). */
  status?: string;
  unread: boolean;
  messages: InboxMessage[];
  /**
   * `waiting`: my message request, not accepted yet, so I can't send more. `left`: the other person deleted their account
   * (their messages went with it). `closed`: the chat was closed (an application chat 30 days after the application
   * closed, or when it was withdrawn or blocked). `paused`: the company is suspended while we review it. Example
   * threads have none.
   */
  state?: "waiting" | "left" | "closed" | "paused";
};

export const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "application", label: "Applications" },
  { key: "person", label: "People" },
  { key: "request", label: "Requests" },
];

/** Threads shown under a filter, in their order. */
export const filterThreads = (threads: InboxThread[], filter: InboxFilter) => threads.filter((t) => filter === "all" || t.kind === filter);

/** The unread badge on the top bar counts unread threads, not messages. A pending request counts as unread. */
export const unreadCount = (threads: InboxThread[]) => threads.filter((t) => t.unread).length;

/** The last message a person wrote, for the list preview (system lines are skipped). */
export const lastMessage = (thread: InboxThread) => [...thread.messages].reverse().find((m) => m.by !== "system");

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Report reasons as the Report panel lists them, in this order (keys: REPORT_REASONS in lib/schemas/inbox). */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  money_or_otp: "Asked for money, an OTP or bank details",
  fake_or_spam: "Fake job, scam or spam",
  harassment: "Harassment or abuse",
  intimate_or_impersonation: "Sexual content, or pretending to be someone",
  other: "Something else",
};

/** What the Inbox screen can do on real chats. Each returns an error to show, or null when it worked. */
export type InboxActions = {
  send: (conversationId: string, body: string) => Promise<string | null>;
  accept: (conversationId: string) => Promise<string | null>;
  remove: (conversationId: string) => Promise<string | null>;
  report: (input: { conversationId: string; target: "person" | "chat"; reason: ReportReason; note?: string; block: boolean }) => Promise<string | null>;
  read: (conversationId: string) => Promise<void>;
  /** Answers "Ask for times" with the picked slot keys (corporate build step 6). */
  offerTimes?: (messageId: string, slots: string[]) => Promise<string | null>;
};
