import { z } from "zod";
import type { NotificationView } from "@/lib/notifications/types";
import { NOTIFICATION_KINDS } from "./constants";

/*
 * Notifications, in-app (docs/plans/notifications-plan.md, migration 0043). A row holds ids only; these schemas check
 * what the server writes, what the panel gets and what the download holds.
 */

export const notificationKind = z.enum(NOTIFICATION_KINDS);

/**
 * What `notify` writes, one shape per kind, each with exactly the reference that kind needs (the database's
 * notifications_refs check holds the same rule).
 */
export const notifyInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["connection_request", "connection_accepted"]), userId: z.uuid(), actorId: z.uuid(), connectionRequestId: z.uuid() }),
  z.strictObject({ kind: z.enum(["application_moved", "application_closed"]), userId: z.uuid(), actorId: z.uuid(), applicationId: z.uuid() }),
  z.strictObject({ kind: z.enum(["interview_scheduled", "interview_cancelled"]), userId: z.uuid(), actorId: z.uuid(), interviewId: z.uuid() }),
]);
export type NotifyInput = z.infer<typeof notifyInput>;

/** One row of the panel, as sent to the browser: nothing but the sentence, its link and time. */
export const notificationView = z.strictObject({
  id: z.uuid(),
  kind: notificationKind,
  text: z.string().min(1).max(500),
  // A path in the app; never another site, protocol-relative ones included.
  href: z.string().regex(/^\/(?!\/)[a-z0-9/?=_.-]*$/i),
  when: z.string().min(1).max(40),
  isNew: z.boolean(),
}) satisfies z.ZodType<NotificationView>;

/** Opening the panel takes nothing: the server knows who is signed in. */
export const openNotificationsInput = z.strictObject({});

/**
 * Download your data, from version 29: each notification's kind and dates, with the company and job for the ones about an
 * application or interview. Other people's names are left out.
 */
export const notificationExport = z.strictObject({
  kind: notificationKind,
  created_at: z.string(),
  read_at: z.string().nullable(),
  company: z.string().optional(),
  job: z.string().optional(),
});
export type NotificationExport = z.infer<typeof notificationExport>;
