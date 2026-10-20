import type { NotificationKind } from "@/lib/schemas/constants";

/*
 * Notifications, in-app (docs/plans/notifications-plan.md). Plain types the bell and the panel use in the browser; the
 * Zod schemas that check them live in @/lib/schemas/notifications, on the server.
 */

/** One row in the panel. The sentence, link and time are worked out on the server from the live rows. */
export type NotificationView = {
  id: string;
  kind: NotificationKind;
  /** One sentence, such as "Ravi Menon asked to connect." */
  text: string;
  /** Where the row opens: a path in the app. */
  href: string;
  /** "Just now", "5 min ago", "2 h ago", "Yesterday" or "4 days ago", India time. */
  when: string;
  /** Unread when the panel opened: shown bold until it closes. */
  isNew: boolean;
};

/** What opening the panel answers: the newest rows (all marked read as they are sent), or words to show. */
export type NotificationsOpened = { items: NotificationView[] } | { error: string };

/** Opens the panel: a server action on signed-in screens, example data on /design and the example shell. */
export type OpenNotifications = () => Promise<NotificationsOpened>;
