import { APPLICATION_STAGE_LABELS, type NotificationKind } from "@/lib/schemas/constants";
import { indiaDay } from "@/lib/ride/days";
import { slotLabel } from "@/lib/corporate/slots";
import { istClock, istDayWords } from "@/lib/day-words";
import { GAC_APPEAL_DAYS } from "@/lib/schemas/legal-timings";

/*
 * Notifications (docs/plans/notifications-plan.md): the pure rules. Which reference each kind holds, the sentence and
 * link each row shows (built from the live rows, never from stored text), the relative time and the bell's label.
 */

export type NotificationRef = "connectionRequestId" | "applicationId" | "interviewId" | "postId" | "commentId" | "reportId" | "appealId";

/** The one reference column each kind sets; the database check holds the same rule. */
export const NOTIFICATION_REF: Record<NotificationKind, NotificationRef> = {
  connection_request: "connectionRequestId",
  connection_accepted: "connectionRequestId",
  application_moved: "applicationId",
  application_closed: "applicationId",
  interview_scheduled: "interviewId",
  interview_cancelled: "interviewId",
  junction_comment: "postId",
  junction_post_hidden: "postId",
  junction_comment_hidden: "commentId",
  junction_appeal_decided: "appealId",
  report_decided: "reportId",
  report_filed: "reportId",
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
  /** Junction and reports (migration 0059), read live; absent for the other kinds. */
  postId?: string | null;
  postTitle?: string | null;
  /** The rule a hidden post or comment broke, in words. */
  rule?: string | null;
  appealStatus?: "open" | "upheld" | "reversed" | null;
  reportStatus?: "open" | "actioned" | "dismissed" | null;
  reportedAt?: Date | null;
  /** The report's reason in words, for the admin's bell. */
  reportReason?: string | null;
  decideBy?: Date | null;
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
    case "junction_comment":
      return `${f.actorName} commented on your post "${f.postTitle ?? "a post"}".`;
    case "junction_post_hidden":
      return `Your post "${f.postTitle ?? "a post"}" was hidden after a report. Reason: ${f.rule ?? "it broke CareerMetro's rules"}.`;
    case "junction_comment_hidden":
      return `Your comment was hidden after a report. Reason: ${f.rule ?? "it broke CareerMetro's rules"}.`;
    case "junction_appeal_decided":
      return f.appealStatus === "reversed"
        ? "We looked at your appeal. It is back for everyone to see."
        : `We looked at your appeal. It stays hidden. If you disagree, you can appeal to the Grievance Appellate Committee at gac.gov.in within ${GAC_APPEAL_DAYS} days.`;
    case "report_decided": {
      const from = f.reportedAt ? ` from ${istDayWords(f.reportedAt)}` : "";
      return f.reportStatus === "actioned" ? `We looked at your report${from}. We acted on it.` : `We looked at your report${from}. We didn't find a rule break.`;
    }
    case "report_filed":
      return `New report: ${f.reportReason ?? "a report"}.${f.decideBy ? ` Act by ${istDayWords(f.decideBy)}, ${istClock(f.decideBy)} IST.` : ""}`;
  }
}

/** Where the row opens. */
export function hrefFor(f: Pick<NotificationFacts, "kind" | "actorHandle" | "postId">): string {
  switch (f.kind) {
    case "connection_request":
      return "/network?tab=requests";
    case "connection_accepted":
      return f.actorHandle ? `/u/${f.actorHandle}` : "/network";
    case "junction_comment":
      return f.postId ? `/junction/p/${f.postId}` : "/junction";
    case "junction_post_hidden":
    case "junction_appeal_decided":
      return "/junction/mine";
    case "junction_comment_hidden":
      return "/junction/mine?tab=comments";
    case "report_decided":
      return "/grievances";
    case "report_filed":
      return "/admin/reports";
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
