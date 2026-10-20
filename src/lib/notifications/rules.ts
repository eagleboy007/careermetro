import { APPLICATION_STAGE_LABELS, type NotificationKind } from "@/lib/schemas/constants";
import { indiaDay } from "@/lib/ride/days";
import { slotLabel } from "@/lib/corporate/slots";

/*
 * Notifications (docs/plans/notifications-plan.md): the pure rules. Which reference each kind holds, the sentence and
 * link each row shows (built from the live rows, never from stored text), the relative time and the bell's label.
 */

export type NotificationRef = "connectionRequestId" | "applicationId" | "interviewId";

/** The one reference column each kind sets; the database check holds the same rule. */
export const NOTIFICATION_REF: Record<NotificationKind, NotificationRef> = {
  connection_request: "connectionRequestId",
  connection_accepted: "connectionRequestId",
  application_moved: "applicationId",
  application_closed: "applicationId",
  interview_scheduled: "interviewId",
  interview_cancelled: "interviewId",
};

/** The kinds about an application, which pause with job search (Arrivals is paused then). Interviews always show. */
export const APPLICATION_KINDS = ["application_moved", "application_closed"] as const satisfies readonly NotificationKind[];

/** What the panel's sentence is built from: read live when it opens. */
export type NotificationFacts = {
  kind: NotificationKind;
  actorName: string;
  actorHandle: string | null;
  company: string | null;
  job: string | null;
  stage: keyof typeof APPLICATION_STAGE_LABELS | null;
  startsAt: Date | null;
};

const forJob = (f: NotificationFacts) => f.job ?? "a job";
const company = (f: NotificationFacts) => f.company ?? "A company";

/** The row's one sentence. */
export function sentenceFor(f: NotificationFacts): string {
  switch (f.kind) {
    case "connection_request":
      return `${f.actorName} asked to connect.`;
    case "connection_accepted":
      return `${f.actorName} accepted your request. You can message them now.`;
    case "application_moved":
      // Read live: an application closed since reads as closed.
      return f.stage === "not_this_time"
        ? `${company(f)} closed your application for ${forJob(f)}. Their note is on Arrivals.`
        : `${company(f)} moved your application for ${forJob(f)} to ${f.stage ? APPLICATION_STAGE_LABELS[f.stage] : "a new stage"}.`;
    case "application_closed":
      return `${company(f)} closed your application for ${forJob(f)}. Their note is on Arrivals.`;
    case "interview_scheduled":
      return `${company(f)} set an interview for ${forJob(f)}${f.startsAt ? `: ${slotLabel(f.startsAt)} IST` : ""}.`;
    case "interview_cancelled":
      return `${company(f)} cancelled the interview for ${forJob(f)}.`;
  }
}

/** Where the row opens. */
export function hrefFor(f: Pick<NotificationFacts, "kind" | "actorHandle">): string {
  switch (f.kind) {
    case "connection_request":
      return "/network?tab=requests";
    case "connection_accepted":
      return f.actorHandle ? `/u/${f.actorHandle}` : "/network";
    default:
      return "/arrivals";
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** "Just now", "5 min ago", "2 h ago", then by India day: "Yesterday", "4 days ago". Worked out on the server. */
export function relativeTime(at: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - at.getTime());
  if (ms < MIN) return "Just now";
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min ago`;
  const days = Math.round((Date.parse(indiaDay(now)) - Date.parse(indiaDay(at))) / 86_400_000);
  if (days <= 0 || ms < 6 * HOUR) return `${Math.floor(ms / HOUR)} h ago`;
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** The bell's accessible name, as the prototype: "Notifications, 2 new", or "Notifications" with nothing new. */
export const bellLabel = (n: number): string => (n > 0 ? `Notifications, ${n} new` : "Notifications");
