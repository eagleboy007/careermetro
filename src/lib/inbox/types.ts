export type InboxKind = "application" | "person" | "request";
export type InboxFilter = "all" | InboxKind;

export type InboxMessage = {
  by: "me" | "them" | "system";
  /** For a company's message, the person at the company who wrote it. */
  who?: string;
  type?: "text" | "times" | "question";
  text: string;
  at?: string;
};

export type InboxThread = {
  id: string;
  kind: InboxKind;
  /** The company for an application, otherwise the person. */
  name: string;
  /** Application chats: the job applied for. */
  job?: string;
  /** People and requests: the status they set (Working at X, Studying and so on). */
  status?: string;
  unread: boolean;
  messages: InboxMessage[];
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
